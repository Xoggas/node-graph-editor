import { defineConfig, searchForWorkspaceRoot } from "vite";
// @ts-expect-error type error without @types/node package
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error type error without @types/node package
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// The built-in pack's resources point outside the repo (at the game's assets, pack.json →
// resources.root). In a browser dev session those files are served through /@fs/, so allow that root.
const bundledPackDir = resolve(process.cwd(), "packs/pumpkin-quest");
const manifestFile = resolve(bundledPackDir, "pack.json");
const resourcesRoot = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).resources?.root : undefined;
const libraryRoot = typeof resourcesRoot === "string" ? resolve(bundledPackDir, resourcesRoot) : null;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  define: {
    __BUNDLED_PACK_DIR__: JSON.stringify(bundledPackDir.replace(/\\/g, "/")),
  },
  // Desktop app loads assets locally; one Pixi-sized bundle is fine.
  build: { chunkSizeWarningLimit: 1500 },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd()), ...(libraryRoot ? [libraryRoot] : [])],
    },
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
