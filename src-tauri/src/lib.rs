use std::fs;
use std::path::{Path, PathBuf};

/// Limits keep a mistakenly chosen folder (e.g. a drive root) from hanging the app.
const MAX_PACK_FILES: usize = 2000;
const MAX_PACK_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_PACK_DEPTH: usize = 8;

#[derive(serde::Serialize)]
struct PackFile {
    /// Relative to the pack root, with forward slashes.
    path: String,
    text: String,
}

#[tauri::command]
fn read_graph_file(path: PathBuf) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| format!("Could not read '{}': {error}", path.display()))
}

/// Writes through a temporary file next to the target so a failed save never corrupts the existing graph.
#[tauri::command]
fn write_graph_file(path: PathBuf, contents: String) -> Result<(), String> {
    write_atomically(&path, contents.as_bytes())
        .map_err(|error| format!("Could not write '{}': {error}", path.display()))
}

fn write_atomically(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if let Some(directory) = path.parent().filter(|directory| !directory.as_os_str().is_empty()) {
        fs::create_dir_all(directory)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    fs::write(&temporary, contents)?;
    fs::rename(&temporary, path).inspect_err(|_| {
        let _ = fs::remove_file(&temporary);
    })
}

/// Reads every `.json` file of a schema pack folder.
#[tauri::command]
fn read_schema_pack(path: PathBuf) -> Result<Vec<PackFile>, String> {
    if !path.join("pack.json").is_file() {
        return Err(format!("'{}' is not a schema pack: pack.json is missing.", path.display()));
    }
    let mut files = Vec::new();
    collect_json(&path, &path, 0, &mut files).map_err(|error| format!("Could not read '{}': {error}", path.display()))?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

fn collect_json(root: &Path, directory: &Path, depth: usize, files: &mut Vec<PackFile>) -> std::io::Result<()> {
    if depth > MAX_PACK_DEPTH {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            collect_json(root, &path, depth + 1, files)?;
        } else if file_type.is_file()
            && path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
            && entry.metadata()?.len() <= MAX_PACK_FILE_BYTES
        {
            if files.len() >= MAX_PACK_FILES {
                return Err(std::io::Error::other(format!("more than {MAX_PACK_FILES} JSON files")));
            }
            let relative = path.strip_prefix(root).unwrap_or(&path);
            let relative = relative.components().map(|part| part.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            files.push(PackFile { path: relative, text: fs::read_to_string(&path)? });
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_graph_file, write_graph_file, read_schema_pack])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_pack_json_files_recursively() {
        let directory = std::env::temp_dir().join(format!("node-graph-editor-pack-{}", std::process::id()));
        write_atomically(&directory.join("pack.json"), b"{}").unwrap();
        write_atomically(&directory.join("nodes").join("a.json"), b"[]").unwrap();
        write_atomically(&directory.join("nodes").join("notes.txt"), b"skip").unwrap();
        let files = read_schema_pack(directory.clone()).unwrap();
        let paths: Vec<_> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, ["nodes/a.json", "pack.json"]);
        assert!(read_schema_pack(directory.join("nodes")).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn atomic_write_replaces_existing_file() {
        let directory = std::env::temp_dir().join(format!("node-graph-editor-test-{}", std::process::id()));
        let path = directory.join("nested").join("graph.json");
        write_atomically(&path, b"first").unwrap();
        write_atomically(&path, b"second").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "second");
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(directory).unwrap();
    }
}
