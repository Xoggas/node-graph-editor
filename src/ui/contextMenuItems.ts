import type { Editor } from "../app/editor";
import { shortcutLabel } from "../app/shortcuts";
import type { ContextMenuRequest, GraphRenderer } from "../render/GraphRenderer";
import type { ContextMenuItem } from "./ContextMenu";

/** Menu for a right click on a node, a connection or empty canvas; actions match the shortcuts. */
export function buildContextMenu(request: ContextMenuRequest, editor: Editor, renderer: GraphRenderer): ContextMenuItem[] {
  const { target } = request;

  if (target.kind === "edge") {
    return [{ label: "Delete connection", shortcut: shortcutLabel("delete"), danger: true, action: () => renderer.deleteSelection() }];
  }

  if (target.kind === "canvas") {
    return [
      {
        label: "Paste here",
        shortcut: shortcutLabel("paste"),
        disabled: !editor.getSnapshot().canPaste,
        action: () => renderer.selectViews(editor.paste(request.world)),
      },
      "separator",
      { label: "Select all", shortcut: shortcutLabel("selectAll"), action: () => renderer.selectAll() },
      { label: "Frame everything", shortcut: shortcutLabel("frameAll"), action: () => renderer.frameAll() },
    ];
  }

  const selection = renderer.selectedViewIds();
  const single = selection.length === 1;
  const node = editor.graph.viewNode(target.viewId);
  const isCopy = !!editor.graph.getAlias(target.viewId);
  const linked = node ? editor.graph.viewIdsOf(node.id).length > 1 : false;
  const count = selection.length > 1 ? ` ${selection.length} nodes` : "";

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
      action: () => renderer.selectViews(editor.duplicate(renderer.selectedViewIds())),
    },
    "separator",
    {
      label: isCopy && single ? "Delete linked copy" : `Delete${count}`,
      shortcut: shortcutLabel("delete"),
      danger: true,
      action: () => renderer.deleteSelection(),
    },
  ];
}
