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
| Edit a field | Click it on the node; double-click the header to rename |
| Move | Drag selected nodes |
| Connect | Drag from a port to a compatible port (compatible ports are highlighted) |
| Undo / Redo | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) |
| Copy / Cut / Paste / Duplicate | Ctrl+C / Ctrl+X / Ctrl+V (at the cursor) / Ctrl+D |
| Delete | Delete / Backspace (selected nodes or connection) |
| Nudge selection | Arrows (Shift: further) |
| Select all / Clear selection | Ctrl+A / Esc |
| Frame selection / Frame all | F / Shift+F or Home |
| Zoom in / out / 100% | Ctrl+= / Ctrl+- / Ctrl+0 |
| New / Open / Save / Save As | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Shortcut reference | F1 |
| Add node | Drag from the palette, or click an item to add it at the view center |

Keyboard shortcuts use physical keys, so they work with any layout (e.g. Russian).
All shortcuts are defined in `src/app/shortcuts.ts`, which also feeds the F1 overlay.

In a dev build, `__editor.generateStressGraph(1000)` in the devtools console replaces the document with
a chain of 1000 nodes of the first pack schema that has a connectable input and output, for performance checks. The status bar shows the CPU time per rendered frame and how many nodes survive culling.

## Structure

```
src/graph/     Framework-free core: schema pack parsing, GraphModel (nodes with schema data,
               ports derived from schema + data, indexed connections), history, clipboard, serializer
src/render/    Pixi renderer: NodeView (fields drawn from the schema), EdgeView, hit testing,
               culling, LOD, inline DOM editors
src/app/       Editor (document + pack state, commands), file access, keymap
src/ui/        React components: canvas host, node palette, shortcut help
src-tauri/     Rust shell: dialogs, atomic graph writes, reading schema pack folders
packs/         Schema packs; pumpkin-quest is built in and used until another pack is chosen
docs/          Design notes (docs/schema-design.md)
```

## Schema packs

The editor has no built-in nodes. Node kinds, port types and resources come from a **schema pack** —
a folder with `pack.json` and `nodes/*.json`. Choose it with **Pack…** in the palette; **Reload**
re-reads it from disk (the open graph keeps its data). The last folder is remembered.

```jsonc
// pack.json
{
  "id": "my-game", "name": "My Game", "version": 1,
  "portTypes": {
    "flow": { "color": "#b8bcc5", "capacity": { "input": "multiple", "output": "single" } },
    "bool": { "color": "#e07a6f" }
  }
}
```

```jsonc
// nodes/lines.json — one schema or an array of schemas per file
{
  "id": "dialogue.line",
  "title": "Line",
  "menu": "Dialogue",
  "color": "#508cdc",
  "naming": { "unique": true, "pattern": "^[\\p{L}0-9 ,.']+$" },
  "meta": { "nodeType": "Blocking" },            // stored and exported as-is
  "ports": [
    { "id": "in", "direction": "input", "type": "flow" },
    { "id": "choice", "direction": "output", "type": "flow", "repeat": { "list": "choices", "label": "Choice {n}" } },
    { "id": "next", "direction": "output", "type": "flow" }
  ],
  "fields": [
    { "id": "text", "type": "string", "multiline": true },
    { "id": "choices", "type": "list", "item": { "type": "record", "fields": [{ "id": "text", "type": "string" }] } }
  ]
}
```

- **Field types:** `int`, `float` (`min`, `max`), `string` (`multiline`, `placeholder`), `bool`,
  `enum` (`options`, `display: "dropdown" | "segmented"`), `list` (`item`, `minItems`, `maxItems`,
  `itemLabel`), `record` (`fields`; every record gets a GUID `id`), `nodeRef` (`schema`: a node of that
  schema, stored as its GUID), `itemRef` (`schema`, `list`: a list element in such a node, stored as the
  element GUID), `matrix` (bool grid; `rows` / `columns` name an int or list field, `rowLabel`,
  `columnLabel`; stored as `{ rowKey: { columnKey: bool } }`, keys are element GUIDs or indices).
  Fields of other types are shown as "not supported yet" and their data is kept.
- References to deleted nodes/elements are not cleared; they show "missing" and resolve again after undo.
- **Resources:** `resource` (`resourceType`, `previewHeight`) picks an item of the pack's resource
  library and shows its image under the field; `resourceVariant` (`source`: a resource field,
  `collection`) picks one of its variants, e.g. an emotion. Changing the resource resets a variant the
  new resource does not have to the collection default.
- **Ports:** `repeat: { list }` creates one port per list element, keyed `<port>:<element GUID>` and
  drawn on the element's row, so reordering elements keeps connections; `repeat: { count }` creates one
  per number of an int field.
  Capacity defaults come from the port type.
- **Naming:** `editable`, `unique`, `pattern`. `singleton: true` allows one node per graph.
- Problems in a node schema skip that node and are listed under ⚠ in the palette.

### Resource library

`pack.json` declares resource types; `resources/*.json` list the items. Images are not copied: a
library's `root` (relative to the library file, or absolute) points at the folder the paths are
relative to, and the editor loads and downscales images on demand. Only files inside library roots can
be read.

```jsonc
// pack.json
"resourceTypes": {
  "character": { "label": "Characters", "variants": { "emotions": { "label": "Emotion", "default": "Idle" } } },
  "background": { "label": "Backgrounds" },
  "music": { "label": "Music", "media": "audio" }
}
// resources/library.json
{
  "root": "../../../../pumpkin-quest/PumpkinQuest/Assets",
  "items": [
    { "id": "ec497a02-…", "type": "character", "name": "Arleen", "image": "Sprites/Characters/Arleen.png",
      "variants": { "emotions": [{ "id": "Arleen_Laughter", "label": "Laughter", "image": "Sprites/Emotions/Arleen/Arleen_Laughter.png" }] } }
  ]
}
```

`tools/import-unity-resources.mjs <UnityProject/Assets>` regenerates the Pumpkin Quest library from the
Unity project (characters with emotions, backgrounds, music, sfx, diary entries), keeping the asset ids.

See `docs/schema-design.md` for the full design, including the planned resource library,
localization and the remaining field types.

## File format

Graphs are JSON (`"format": "node-graph", "version": 2`). Each node stores its schema id and version,
name, position and `data`; connections reference `{ node, port }` with the schema port key. Nodes whose
schema is missing load as placeholders and are written back unchanged; connections that cannot be
restored (e.g. to a removed repeated port) are kept in `unresolvedConnections`.

## Performance notes

- Graph changes update the scene incrementally; nothing is rebuilt on add/remove.
- Frames are rendered on demand, so an idle editor costs nothing.
- Each connection is its own `Graphics`; only connections touching moved nodes are re-tessellated.
  Connections inside a dragged group are translated instead of rebuilt.
- Off-screen nodes and connections are culled; text is hidden below 40% zoom.
- Text uses a shared bitmap font, so nodes batch into few draw calls.
- Hit testing is done in graph space by the renderer instead of Pixi's per-object event system.
