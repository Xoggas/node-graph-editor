import type { Editor } from "../app/editor";
import { t } from "../i18n";
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
      renderer.selectedViewIds().length > 0
        ? t("Delete selection")
        : edges > 1
          ? t("Delete {count} connections", { count: edges })
          : t("Delete connection");
    return [{ label, shortcut: shortcutLabel("delete"), danger: true, action: () => renderer.deleteSelection() }];
  }

  if (target.kind === "canvas") {
    return [
      { label: t("Add sticky note"), shortcut: shortcutLabel("addNote"), action: () => renderer.addNoteAt(request.world) },
      {
        label: t("Paste here"),
        shortcut: shortcutLabel("paste"),
        disabled: !editor.getSnapshot().canPaste,
        action: () => void editor.paste(request.world).then((ids) => renderer.selectViews(ids)),
      },
      "separator",
      { label: t("Select all"), shortcut: shortcutLabel("selectAll"), action: () => renderer.selectAll() },
      { label: t("Frame everything"), shortcut: shortcutLabel("frameAll"), action: () => renderer.frameAll() },
    ];
  }

  const selection = renderer.selectedViewIds();
  const single = selection.length === 1;
  // "Copy" for one element, "Copy 3 elements" for several.
  const many = selection.length > 1;
  const counted = (one: string, several: string) => (many ? t(several, { count: selection.length }) : t(one));
  const clipboardItems: ContextMenuItem[] = [
    { label: counted("Copy", "Copy {count} elements"), shortcut: shortcutLabel("copy"), action: () => editor.copy(renderer.selectedViewIds()) },
    {
      label: counted("Cut", "Cut {count} elements"),
      shortcut: shortcutLabel("cut"),
      action: () => {
        const ids = renderer.selectedViewIds();
        renderer.clearSelection();
        editor.cut(ids);
      },
    },
    {
      label: counted("Duplicate", "Duplicate {count} elements"),
      shortcut: shortcutLabel("duplicate"),
      action: () => void editor.duplicate(renderer.selectedViewIds()).then((ids) => renderer.selectViews(ids)),
    },
    {
      label: counted("Duplicate as new", "Duplicate {count} elements as new"),
      shortcut: shortcutLabel("forceDuplicate"),
      action: () => void editor.duplicate(renderer.selectedViewIds(), "copy").then((ids) => renderer.selectViews(ids)),
    },
  ];

  if (target.kind === "note") {
    const note = editor.graph.getNote(target.noteId);
    // The color applies to every selected note.
    const notes = selection.filter((id) => editor.graph.getNote(id));
    return [
      { label: t("Edit text"), shortcut: shortcutLabel("rename"), disabled: !single, action: () => renderer.editNote(target.noteId) },
      {
        swatches: NOTE_COLORS.map((color) => ({
          color: noteColors[color].swatch,
          label: t(color[0].toUpperCase() + color.slice(1)),
          current: note?.color === color,
          action: () => notes.forEach((id) => editor.updateNote(id, { color })),
        })),
      },
      "separator",
      ...clipboardItems,
      "separator",
      { label: counted("Delete", "Delete {count} elements"), shortcut: shortcutLabel("delete"), danger: true, action: () => renderer.deleteSelection() },
    ];
  }

  const node = editor.graph.viewNode(target.viewId);
  const isCopy = !!editor.graph.getAlias(target.viewId);
  const linked = node ? editor.graph.viewIdsOf(node.id).length > 1 : false;

  return [
    {
      label: t("Rename"),
      shortcut: shortcutLabel("rename"),
      disabled: !single || !renderer.canRename(target.viewId),
      action: () => renderer.renameSelection(),
    },
    "separator",
    {
      label: many ? t("Create linked copies") : t("Create linked copy"),
      shortcut: shortcutLabel("linkedCopy"),
      action: () => renderer.selectViews(editor.createLinkedCopies(renderer.selectedViewIds())),
    },
    {
      label: isCopy ? t("Go to the original / next copy") : t("Go to the next linked copy"),
      shortcut: shortcutLabel("nextLinked"),
      disabled: !single || !linked,
      action: () => renderer.goToNextLinkedView(),
    },
    "separator",
    ...clipboardItems,
    "separator",
    {
      label: isCopy && single ? t("Delete linked copy") : counted("Delete", "Delete {count} elements"),
      shortcut: shortcutLabel("delete"),
      danger: true,
      action: () => renderer.deleteSelection(),
    },
  ];
}
