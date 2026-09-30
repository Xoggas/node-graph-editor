use std::fs;
use std::path::{Path, PathBuf};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![read_graph_file, write_graph_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
