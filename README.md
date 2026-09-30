# Node Graph Editor

Desktop node graph editor built with **Tauri 2**, **React**, **TypeScript** and **Pixi.js v8** (WebGL).
Designed to stay smooth with 1000+ nodes and thousands of connections.

## Running

```sh
npm install
npm run tauri dev      # desktop app with hot reload
npm run dev            # frontend only, in a browser (file dialogs fall back to upload/download)
npm test               # graph model + serializer tests (vitest)
npm run tauri build    # release build + installer
```

Requires Node.js and a Rust toolchain ([Tauri prerequisites](https://tauri.app/start/prerequisites/)).

## Controls

| Action | Input |
| --- | --- |
| Pan | Right or middle mouse drag, or Space + left drag |
| Zoom | Mouse wheel (around the cursor) |
| Select | Click; Shift adds, Ctrl toggles; drag on empty space for box selection |
| Move | Drag selected nodes |
| Connect | Drag from a port to a compatible port (compatible ports are highlighted) |
| Delete | Delete / Backspace (selected nodes or connection) |
| Select all / Frame all | Ctrl+A / F |
| New / Open / Save / Save As | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Add node | Drag from the palette, or click an item to add it at the view center |

**Stress 1000** in the toolbar replaces the document with 1000 generated nodes and ~1900 connections.
The status bar shows the CPU time per rendered frame and how many nodes survive culling.

## Structure

```
src/graph/     Framework-free graph core: data types with inheritance, node definitions,
               GraphModel (indexed nodes/ports/connections + change events), JSON serializer
src/render/    Pixi renderer: NodeView, EdgeView, hit testing, culling, LOD, interaction
src/app/       Editor (document state, commands) and file access (Tauri dialogs / browser fallback)
src/ui/        React components: canvas host, node palette
src-tauri/     Rust shell: dialog plugin + atomic read/write of graph files
```

## Defining nodes

Nodes are plain definitions registered in a `NodeGraphRegistry` (see `src/graph/samples.ts`):

```ts
registry.dataTypes.register("my.vector");
registry.dataTypes.register("my.vector3", ["my.vector"]); // assignable to my.vector

registry.nodes.register({
  typeId: "my.scale",
  displayName: "Scale",
  menuPath: "Math",
  ports: [
    { key: "in", direction: "Input", typeId: "my.vector" },
    { key: "factor", direction: "Input", typeId: "system.float" },
    { key: "out", direction: "Output", typeId: "my.vector" },
  ],
  defaultState: () => ({ factor: 1 }),
  widgets: [
    { kind: "number", label: "Factor", get: (s) => s.factor, set: (s, factor) => ({ ...s, factor }) },
  ],
});
```

Connections are type-checked: an output can feed an input when its type equals the input type,
inherits from it, or the input is `system.object`. Inputs default to a single connection, outputs to many.

## File format

Graphs are stored as JSON (`"format": "node-graph", "version": 1`), compatible with files saved by the
previous Unity implementation. Nodes of unknown types, or whose ports no longer match their definition,
load as placeholders and are written back unchanged; connections that cannot be restored are kept in
`unresolvedConnections`.

## Performance notes

- Graph changes update the scene incrementally; nothing is rebuilt on add/remove.
- Frames are rendered on demand, so an idle editor costs nothing.
- Each connection is its own `Graphics`; only connections touching moved nodes are re-tessellated.
  Connections inside a dragged group are translated instead of rebuilt.
- Off-screen nodes and connections are culled; text is hidden below 40% zoom.
- Text uses a shared bitmap font, so nodes batch into few draw calls.
- Hit testing is done in graph space by the renderer instead of Pixi's per-object event system.
