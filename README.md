# Node Graph Editor 🕸️

A desktop editor for branching dialogue and other node graphs, made for games. It has no node types of its own. The nodes, their ports, the character portraits and the languages all come from a schema pack that the game generates, so any engine that can write a few JSON files can use it.

## What it does

- 🧩 Builds every node from its schema: number, text and dropdown fields, lists, checkbox grids, references to other nodes, and ports that repeat per list item.
- 🌍 Keeps the texts in the pack's localization tables. You edit a line right on the node, in the language picked in the toolbar, and the Localization tab puts two languages side by side with filters for missing and unused keys.
- 🔀 Shows which choices a line offers: every choice it reaches through If and other non-blocking nodes, with those routes drawn dashed.
- 🔗 Places one node at several spots of the graph as linked copies. An edit shows in all of them, and each copy keeps its own connections.
- 🖼️ Shows the game's resources in place: character portraits with their emotions, backgrounds and music, read from the game's own asset folders.
- ✅ Checks the graph after every edit and lists unconnected ports, nodes the story never reaches, loops that never wait for the player, variables that are read but never written, and missing translations.
- 📤 Exports a compact runtime JSON and the localization tables for the engine, on demand or on every save.

It also has undo and redo, copy and paste, search through names and texts in all languages, sticky notes, and an interface in English or Russian. Shortcuts follow physical keys, so they work in any keyboard layout.

## How it fits into a game

```text
game code ──▶ schema pack ──▶ editor ──▶ <graph>.runtime.json + localization ──▶ game
```

A schema pack is a folder with `pack.json` and one JSON file per node type and per resource. Once you choose the folder, its node types appear in the palette. When the game adds a node type and regenerates the pack, Reload picks it up and the open graph keeps its data. Export leaves out positions and other editor data, so the game gets the nodes with their fields and connections.

The pack is plain JSON, so a game can write it by hand or generate it from the node classes in its own code.

## Performance

The canvas is drawn with Pixi.js on WebGL, and graphs with more than a thousand nodes stay smooth. The editor draws a frame only when something changes, so it costs nothing while idle. It skips nodes outside the view, hides text when zoomed far out, and redraws only the connections of the nodes that move.

## Download

The Windows installer is on the [Releases](https://github.com/Xoggas/node-graph-editor/releases/latest) page.

Running it from source needs Node.js and a Rust toolchain (see the [Tauri prerequisites](https://tauri.app/start/prerequisites/)):

```sh
npm install
npm run tauri dev      # the desktop app with hot reload
npm run tauri build    # a release build and its installer
```

## Built with

Tauri 2, with a Rust shell for dialogs, atomic file writes and reading pack folders. The interface is React and TypeScript, and the canvas is Pixi.js v8.

## Documentation

- [Guide and format reference](docs/guide.md): controls, the schema pack format, graph checks, the file format and the runtime export.
