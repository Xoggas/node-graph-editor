import { invoke, isTauri } from "@tauri-apps/api/core";
import { ask, open, save } from "@tauri-apps/plugin-dialog";
import type { PackFile } from "../graph/schema";

export interface OpenedFile {
  /** Null when running in a plain browser, where files have no stable path. */
  path: string | null;
  name: string;
  text: string;
}

export interface SavedFile {
  path: string | null;
  name: string;
}

export interface GraphFileSystem {
  open(): Promise<OpenedFile | null>;
  save(text: string, currentPath: string | null, chooseLocation: boolean): Promise<SavedFile | null>;
  confirm(message: string): Promise<boolean>;
  /** Resolves null when the user cancels. */
  pickPackFolder(): Promise<string | null>;
  readPackFolder(path: string): Promise<PackFile[]>;
  /** Restricts resource reads to these folders (the loaded pack's library roots). */
  setResourceRoots(roots: string[]): Promise<void>;
  readResource(path: string): Promise<Blob>;
}

const FILTERS = [{ name: "JSON graph", extensions: ["json"] }];

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

class TauriFileSystem implements GraphFileSystem {
  async open(): Promise<OpenedFile | null> {
    const path = await open({ title: "Open node graph", multiple: false, directory: false, filters: FILTERS });
    if (typeof path !== "string") {
      return null;
    }
    const text = await invoke<string>("read_graph_file", { path });
    return { path, name: fileName(path), text };
  }

  async save(text: string, currentPath: string | null, chooseLocation: boolean): Promise<SavedFile | null> {
    let path = currentPath;
    if (!path || chooseLocation) {
      path = await save({ title: "Save node graph", defaultPath: currentPath ?? "graph.json", filters: FILTERS });
    }
    if (!path) {
      return null;
    }
    await invoke("write_graph_file", { path, contents: text });
    return { path, name: fileName(path) };
  }

  confirm(message: string): Promise<boolean> {
    return ask(message, { title: "Node Graph Editor", kind: "warning" });
  }

  async pickPackFolder(): Promise<string | null> {
    const path = await open({ title: "Choose a schema pack folder (with pack.json)", directory: true, multiple: false });
    return typeof path === "string" ? path : null;
  }

  readPackFolder(path: string): Promise<PackFile[]> {
    return invoke<PackFile[]>("read_schema_pack", { path });
  }

  async setResourceRoots(roots: string[]): Promise<void> {
    await invoke("set_resource_roots", { roots });
  }

  async readResource(path: string): Promise<Blob> {
    const bytes = await invoke<ArrayBuffer>("read_resource_file", { path });
    return new Blob([bytes]);
  }
}

/** Fallback for running the frontend in a regular browser (`npm run dev`). */
class BrowserFileSystem implements GraphFileSystem {
  open(): Promise<OpenedFile | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
          return;
        }
        file.text().then((text) => resolve({ path: null, name: file.name, text }), reject);
      });
      input.addEventListener("cancel", () => resolve(null));
      input.click();
    });
  }

  async save(text: string, currentPath: string | null): Promise<SavedFile | null> {
    const name = currentPath ? fileName(currentPath) : "graph.json";
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { path: null, name };
  }

  async confirm(message: string): Promise<boolean> {
    return window.confirm(message);
  }

  async pickPackFolder(): Promise<string | null> {
    throw new Error("choosing a pack folder needs the desktop app; the built-in pack is used");
  }

  async readPackFolder(path: string): Promise<PackFile[]> {
    throw new Error(`Reading pack folders is only available in the desktop app ('${path}').`);
  }

  async setResourceRoots(): Promise<void> {}

  /** Served by the Vite dev server (see `server.fs.allow` in vite.config.ts). */
  async readResource(path: string): Promise<Blob> {
    const response = await fetch(`/@fs/${path.replace(/^\//, "")}`);
    if (!response.ok) {
      throw new Error(`Could not load '${path}' (${response.status}).`);
    }
    return response.blob();
  }
}

export function createFileSystem(): GraphFileSystem {
  return isTauri() ? new TauriFileSystem() : new BrowserFileSystem();
}
