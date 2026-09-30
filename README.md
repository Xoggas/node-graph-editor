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
| Select | Click; Shift adds, Ctrl toggles; drag on empty space for box selection. Works for nodes and connections; a box picks connections only when it touches no node |
| Edit a field | Click it on the node; double-click the header to rename |
| Move | Drag selected nodes |
| Connect | Drag from a port to a compatible port (compatible ports are highlighted) |
| Undo / Redo | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) |
| Copy / Cut / Paste / Duplicate | Ctrl+C / Ctrl+X / Ctrl+V (at the cursor) / Ctrl+D |
| Create linked copy / Go to the next linked copy | Ctrl+L / Ctrl+Shift+L |
| Rename node / Context menu | F2 / Right click (right drag pans) |
| Find nodes (name, type, texts in all languages, fields) | Ctrl+F — arrows preview, Enter goes, Esc closes |
| Delete | Delete / Backspace (selected nodes and connections) |
| Nudge selection | Arrows (Shift: further) |
| Select all / Clear selection | Ctrl+A / Esc |
| Frame selection / Frame all | F / Shift+F or Home |
| Zoom in / out / 100% | Ctrl+= / Ctrl+- / Ctrl+0 |
| New / Open / Save / Save As | Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S |
| Export for the engine / Export As | Ctrl+E / Ctrl+Shift+E |
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
  "menus": ["Flow", "Dialogue", "Conditions"],   // palette category order; nodes keep their file order
  "portTypes": {
    // `required`: ports of this type should be connected (checked, see "Problems")
    "flow": { "color": "#b8bcc5", "capacity": { "input": "multiple", "output": "single" }, "required": ["input", "output"] },
    "bool": { "color": "#e07a6f", "required": ["input"] }
  }
}
```

```jsonc
// nodes/lines.json — one schema or an array of schemas per file
{
  "id": "dialogue.line",
  "title": "Line",
  "description": "What the node does; shown by the ? in its header",
  "menu": "Dialogue",
  "color": "#508cdc",
  "naming": { "unique": true, "pattern": "^[\\p{L}0-9 ,.']+$" },
  "blocking": true,                               // the dialogue waits here for the player; exported per type
  // "choice": true,                              // an answer option, shown by the blocking node before it
  "meta": { "voice": "narrator" },                // anything else for the game: stored and exported as-is
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
- **Localized text:** `localizedText` (`keyFrom: "name"`, `keySuffix`, `multiline`) — the text lives in
  `localization/<language>.json` of the pack (languages come from `pack.json`); by default the node name
  is the key. Nodes show the language picked in the toolbar; clicking the field edits that language in place (Ctrl+Enter or click away saves, Esc cancels).
- **Naming:** `editable`, `unique`, `pattern`, `auto: "chapter.index"` (new nodes continue the `1.12`
  numbering). `singleton: true` allows one node per graph.
- Problems in a node schema skip that node and are listed under ⚠ in the palette.

### Localization

`localization/ru.json`, `localization/en.json`, … are flat `{ "key": "text" }` files shared by all graphs
of the pack. Renaming a node moves its texts to the new key (one undo step with the rename), duplicating
a node copies them, and **Save** writes the changed language files together with the graph.

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

`tools/import-unity-graph.mjs <UnityProject/Assets> <out.json> [graph name]` converts a baked Unity
dialogue graph (`Resources/Graphs/<name>_Baked.json`, positions from `<name>.asset`) into an editor graph
and writes the `Dialogues` localization tables into the pack's `localization/*.json`:

- node ids are kept, so references to choices stay valid;
- a choice with a condition becomes `If(condition) → Choice`;
- duplicates become one node with linked copies — same type, data and text, and outputs leading to the same
  nodes (flow) or the same inputs (conditions); choices that conditions refer to are never merged.

See `docs/schema-design.md` for the full design, including the planned resource library,
localization and the remaining field types.

## Problems

The status bar shows the result of the graph checks (**✓ No problems** / **⚠ N warnings** / **✕ N errors**);
clicking it opens the list, clicking a row goes to the node. The checks re-run after every edit.

- **Connections** (per node and per linked copy): ports whose type is `required` but that are not
  connected — a dialogue that stops, a missing condition; a port marked `"optional": true` in the node
  schema may stay open (e.g. an If's False branch). Flow nodes that cannot be reached from the start.
- **Data:** empty fields marked `"required": true`, references to deleted nodes or list elements,
  resources missing from the library, lists shorter than `minItems`. String fields with
  `"symbol": { "kind": "variable", "use": "read" | "write" }` must be written by some node when read
  (catches typos in variable names).
- **Texts:** texts without a localization key (unnamed node) and keys missing a translation.
- **Graph:** no start node or several, unknown node types, connections that could not be restored, and
  endless loops — a flow cycle without a `blocking` node would run forever without the player.

## Choices shown by a line

A node schema with `"choice": true` is an answer option. The blocking node before it shows it — directly
or through non-blocking nodes, e.g. `Line → Choice Matrix → Choice` or `Line → If → Choice`: following the
flow from a blocking node, every choice reached before the next blocking node belongs to it (choices
themselves may be blocking — the dialogue waits for the pick — and are never sources). The
connections of indirect routes — the whole chain, e.g. Line → If and If → Choice — are always drawn dashed; a direct
Line → Choice connection stays solid
(`src/graph/choices.ts`, recomputed after every edit).

## Linked copies

A linked copy (Ctrl+L) deduplicates data: it is the same node — same fields, name, localization key and
**id** — at another place of the graph, so an edit in one place shows in all of them and a choice made
through any copy is the same choice for the game. Connections are **not** shared: every copy (and the
node itself) has its own, with capacity and duplicate checks per copy.

- Copies sit in a blue outer frame and have a `↗ link` badge; the node shows `↗ N` for its N copies. Selecting a
  view highlights the others; Ctrl+Shift+L walks through them.
- Deleting a copy deletes the connections drawn at it; deleting the node deletes its copies.
- Copy/paste: a copy pasted together with its node links to the pasted node, a copy pasted alone links
  to the same node again.
- The runtime export lists copies in `aliases` with their own connections (see below).

## File format

Graphs are JSON (`"format": "node-graph", "version": 2`). Each node stores its schema id and version,
name, position and `data`; connections reference `{ node, port }` with the schema port key, plus
`view` (an alias id) for an end drawn at a linked copy; linked copies are `aliases: [{ id, node, position }]`. Nodes whose
schema is missing load as placeholders and are written back unchanged; connections that cannot be
restored (e.g. to a removed repeated port) are kept in `unresolvedConnections`.

## Runtime export

**Export** (Ctrl+E) writes the engine version of the graph — a compact single-line JSON without editor
data (positions, names, viewport, schema versions, connection ids). The first export asks where to save
(`<graph>.runtime.json` next to the graph by default); later exports overwrite it, Ctrl+Shift+E picks a
new file.

With **on save** checked next to Export (the default, remembered between sessions), every save of a graph
on disk also exports it without asking: to the last export path, or `<graph>.runtime.json` next to the
graph the first time.

```jsonc
{
  "format": "node-graph-runtime", "version": 1,
  "graph": "<graph id>", "pack": "pumpkin-quest",
  "entry": "<start node id>",                        // node of the schema named by pack.json "export.entry"
  "types": { "dialogue.line": { "blocking": true } },   // `blocking` + schema meta, once per type
  "nodes": {
    "<node id>": {
      "type": "dialogue.line",
      "data": { "speaker": "<resource id>", "emotion": "Idle", "line": "1.1" },  // localization key resolved
      "inputs":  { "in":   ["<node id>"] },          // port key → connected nodes; empty ports omitted
      "outputs": { "next": ["<node id>"] }
    }
  },
  "aliases": {                                       // linked copies; omitted when there are none
    "<alias id>": { "node": "<node id>", "inputs": { "in": ["<node id>"] }, "outputs": { "next": ["<alias id>"] } }
  }
}
```

Connections point at places: a node id, or an alias id — the copy shares the node's `type`, `data` and
id (`aliases[id].node`) but continues along its own outputs. The engine should keep the place it is at
(e.g. in a save) and use the node id for identity, such as remembering a made choice.

Next to the export the editor writes `localization/<language>.json` — the texts as they are in the editor, unsaved edits included (the pack's own files are updated by Save). Problems (no start node, deleted
references, texts without a key, nodes without a schema) are reported as warnings and do not stop the
export.

## Performance notes

- Graph changes update the scene incrementally; nothing is rebuilt on add/remove.
- Frames are rendered on demand, so an idle editor costs nothing.
- Each connection is its own `Graphics`; only connections touching moved nodes are re-tessellated.
  Connections inside a dragged group are translated instead of rebuilt.
- Off-screen nodes and connections are culled; text is hidden below 40% zoom.
- Text uses a shared bitmap font, so nodes batch into few draw calls.
- Hit testing is done in graph space by the renderer instead of Pixi's per-object event system.
