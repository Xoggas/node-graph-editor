import type { Editor } from "../app/editor";
import { NOTE_COLORS } from "../graph/types";
import { noteColors } from "../render/theme";
import { shortcutLabel } from "../app/shortcuts";
import type { ContextMenuRequest, GraphRenderer } from "../render/GraphRenderer";
import type { ContextMenuItem } from "./ContextMenu";

/** Menu for a right click on a node, a note, a connection or empty canvas; actions match the shortcuts. */
export function buildContextMenu(request: ContextMenuRequest, editor: Editor, renderer: GraphRenderer): ContextMenuItem[] {
  const { target } = request;

  if (target.kind === "edge") {
    const edges = renderer.selectedConnectionIds().length;
    const label =
      renderer.selectedViewIds().length > 0 ? "Delete selection" : edges > 1 ? `Delete ${edges} connections` : "Delete connection";
    return [{ label, shortcut: shortcutLabel("delete"), danger: true, action: () => renderer.deleteSelection() }];
  }

  if (target.kind === "canvas") {
    return [
      { label: "Add sticky note", shortcut: shortcutLabel("addNote"), action: () => renderer.addNoteAt(request.world) },
      {
        label: "Paste here",
        shortcut: shortcutLabel("paste"),
        disabled: !editor.getSnapshot().canPaste,
        action: () => void editor.paste(request.world).then((ids) => renderer.selectViews(ids)),
      },
      "separator",
      { label: "Select all", shortcut: shortcutLabel("selectAll"), action: () => renderer.selectAll() },
      { label: "Frame everything", shortcut: shortcutLabel("frameAll"), action: () => renderer.frameAll() },
    ];
  }

  const selection = renderer.selectedViewIds();
  const single = selection.length === 1;
  const count = selection.length > 1 ? ` ${selection.length} elements` : "";
  const clipboardItems: ContextMenuItem[] = [
    { label: `Copy${count}`, shortcut: shortcutLabel("copy"), action: () => editor.copy(renderer.selectedViewIds()) },
    {
      label: `Cut${count}`,
      shortcut: shortcutLabel("cut"),
      action: () => {
        const ids = renderer.selectedViewIds();
        renderer.clearSelection();
        editor.cut(ids);
      },
    },
    {
      label: `Duplicate${count}`,
      shortcut: shortcutLabel("duplicate"),
      action: () => void editor.duplicate(renderer.selectedViewIds()).then((ids) => renderer.selectViews(ids)),
    },
    {
      label: `Duplicate as new${count}`,
      shortcut: shortcutLabel("forceDuplicate"),
      action: () => void editor.duplicate(renderer.selectedViewIds(), "copy").then((ids) => renderer.selectViews(ids)),
    },
  ];

  if (target.kind === "note") {
    const note = editor.graph.getNote(target.noteId);
    // The color applies to every selected note.
    const notes = selection.filter((id) => editor.graph.getNote(id));
    return [
      { label: "Edit text", shortcut: shortcutLabel("rename"), disabled: !single, action: () => renderer.editNote(target.noteId) },
      {
        swatches: NOTE_COLORS.map((color) => ({
          color: noteColors[color].swatch,
          label: color[0].toUpperCase() + color.slice(1),
          current: note?.color === color,
          action: () => notes.forEach((id) => editor.updateNote(id, { color })),
        })),
      },
      "separator",
      ...clipboardItems,
      "separator",
      { label: `Delete${count}`, shortcut: shortcutLabel("delete"), danger: true, action: () => renderer.deleteSelection() },
    ];
  }

  const node = editor.graph.viewNode(target.viewId);
  const isCopy = !!editor.graph.getAlias(target.viewId);
  const linked = node ? editor.graph.viewIdsOf(node.id).length > 1 : false;

  return [
    {
      label: "Rename",
      shortcut: shortcutLabel("rename"),
      disabled: !single || !renderer.canRename(target.viewId),
      action: () => renderer.renameSelection(),
    },
    "separator",
    {
      label: selection.length > 1 ? "Create linked copies" : "Create linked copy",
      shortcut: shortcutLabel("linkedCopy"),
      action: () => renderer.selectViews(editor.createLinkedCopies(renderer.selectedViewIds())),
    },
    {
      label: isCopy ? "Go to the original / next copy" : "Go to the next linked copy",
      shortcut: shortcutLabel("nextLinked"),
      disabled: !single || !linked,
      action: () => renderer.goToNextLinkedView(),
    },
    "separator",
    ...clipboardItems,
    "separator",
    {
      label: isCopy && single ? "Delete linked copy" : `Delete${count}`,
      shortcut: shortcutLabel("delete"),
      danger: true,
      action: () => renderer.deleteSelection(),
    },
  ];
}
