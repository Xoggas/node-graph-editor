import type { GraphRenderer } from "../render/GraphRenderer";
import type { Editor } from "./editor";
import { physicalKey } from "./keys";

export interface ShortcutContext {
  editor: Editor;
  renderer: GraphRenderer | null;
  toggleHelp: () => void;
}

interface KeyBinding {
  /** `KeyboardEvent.code`: physical key, so shortcuts work with any keyboard layout. */
  code: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Shortcut {
  group: "File" | "Edit" | "Selection" | "View" | "Help";
  description: string;
  /** Human-readable key labels shown in the help overlay. */
  keys: string[];
  bindings: KeyBinding[];
  /** Also fire while a text field has focus (file commands). */
  global?: boolean;
  run: (context: ShortcutContext, event: KeyboardEvent) => void;
}

const NUDGE = 10;
const NUDGE_LARGE = 50;
const ZOOM_STEP = 1.25;

type RendererAction = (renderer: GraphRenderer, context: ShortcutContext, event: KeyboardEvent) => void;

const withRenderer = (action: RendererAction) => (context: ShortcutContext, event: KeyboardEvent) => {
  if (context.renderer) {
    action(context.renderer, context, event);
  }
};

/** Skips edits while a mouse gesture is in progress (e.g. undo during a drag). */
const whenIdle = (action: RendererAction) =>
  withRenderer((renderer, context, event) => {
    if (!renderer.isInteracting()) {
      action(renderer, context, event);
    }
  });

const ARROW_DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const ARROWS = Object.keys(ARROW_DIRECTIONS);

export const shortcuts: Shortcut[] = [
  {
    group: "File",
    description: "New graph",
    keys: ["Ctrl+N"],
    bindings: [{ code: "KeyN", ctrl: true }],
    global: true,
    run: ({ editor }) => void editor.newGraph(),
  },
  {
    group: "File",
    description: "Open…",
    keys: ["Ctrl+O"],
    bindings: [{ code: "KeyO", ctrl: true }],
    global: true,
    run: ({ editor }) => void editor.open(),
  },
  {
    group: "File",
    description: "Save",
    keys: ["Ctrl+S"],
    bindings: [{ code: "KeyS", ctrl: true }],
    global: true,
    run: ({ editor }) => void editor.save(),
  },
  {
    group: "File",
    description: "Save as…",
    keys: ["Ctrl+Shift+S"],
    bindings: [{ code: "KeyS", ctrl: true, shift: true }],
    global: true,
    run: ({ editor }) => void editor.save(true),
  },
  {
    group: "Edit",
    description: "Undo",
    keys: ["Ctrl+Z"],
    bindings: [{ code: "KeyZ", ctrl: true }],
    run: whenIdle((_, { editor }) => editor.undo()),
  },
  {
    group: "Edit",
    description: "Redo",
    keys: ["Ctrl+Y", "Ctrl+Shift+Z"],
    bindings: [
      { code: "KeyY", ctrl: true },
      { code: "KeyZ", ctrl: true, shift: true },
    ],
    run: whenIdle((_, { editor }) => editor.redo()),
  },
  {
    group: "Edit",
    description: "Copy",
    keys: ["Ctrl+C"],
    bindings: [{ code: "KeyC", ctrl: true }],
    run: withRenderer((renderer, { editor }) => editor.copy(renderer.selectedNodeIds())),
  },
  {
    group: "Edit",
    description: "Cut",
    keys: ["Ctrl+X"],
    bindings: [{ code: "KeyX", ctrl: true }],
    run: whenIdle((renderer, { editor }) => {
      const ids = renderer.selectedNodeIds();
      renderer.clearSelection();
      editor.cut(ids);
    }),
  },
  {
    group: "Edit",
    description: "Paste (at the cursor)",
    keys: ["Ctrl+V"],
    bindings: [{ code: "KeyV", ctrl: true }],
    run: whenIdle((renderer, { editor }) => renderer.selectNodes(editor.paste(renderer.pointerPosition() ?? undefined))),
  },
  {
    group: "Edit",
    description: "Duplicate",
    keys: ["Ctrl+D"],
    bindings: [{ code: "KeyD", ctrl: true }],
    run: whenIdle((renderer, { editor }) => renderer.selectNodes(editor.duplicate(renderer.selectedNodeIds()))),
  },
  {
    group: "Edit",
    description: "Delete selection",
    keys: ["Delete", "Backspace"],
    bindings: [{ code: "Delete" }, { code: "Backspace" }],
    run: whenIdle((renderer) => renderer.deleteSelection()),
  },
  {
    group: "Selection",
    description: "Select all",
    keys: ["Ctrl+A"],
    bindings: [{ code: "KeyA", ctrl: true }],
    run: withRenderer((renderer) => renderer.selectAll()),
  },
  {
    group: "Selection",
    description: "Clear selection",
    keys: ["Esc"],
    bindings: [{ code: "Escape" }],
    run: withRenderer((renderer) => renderer.clearSelection()),
  },
  {
    group: "Selection",
    description: "Move selection (Shift: further)",
    keys: ["Arrows", "Shift+Arrows"],
    bindings: ARROWS.flatMap((code) => [{ code }, { code, shift: true }]),
    run: whenIdle((renderer, _, event) => {
      const step = event.shiftKey ? NUDGE_LARGE : NUDGE;
      const [dx, dy] = ARROW_DIRECTIONS[physicalKey(event)];
      renderer.nudgeSelection(dx * step, dy * step);
    }),
  },
  {
    group: "View",
    description: "Frame selection (or everything)",
    keys: ["F"],
    bindings: [{ code: "KeyF" }],
    run: withRenderer((renderer) => renderer.frameSelection()),
  },
  {
    group: "View",
    description: "Frame everything",
    keys: ["Shift+F", "Home"],
    bindings: [{ code: "KeyF", shift: true }, { code: "Home" }],
    run: withRenderer((renderer) => renderer.frameAll()),
  },
  {
    group: "View",
    description: "Zoom in",
    keys: ["Ctrl+=", "Ctrl+Num+"],
    bindings: [
      { code: "Equal", ctrl: true },
      { code: "Equal", ctrl: true, shift: true },
      { code: "NumpadAdd", ctrl: true },
      { code: "NumpadAdd" },
    ],
    run: withRenderer((renderer) => renderer.zoomBy(ZOOM_STEP)),
  },
  {
    group: "View",
    description: "Zoom out",
    keys: ["Ctrl+-", "Ctrl+Num-"],
    bindings: [
      { code: "Minus", ctrl: true },
      { code: "NumpadSubtract", ctrl: true },
      { code: "NumpadSubtract" },
    ],
    run: withRenderer((renderer) => renderer.zoomBy(1 / ZOOM_STEP)),
  },
  {
    group: "View",
    description: "Zoom to 100%",
    keys: ["Ctrl+0"],
    bindings: [
      { code: "Digit0", ctrl: true },
      { code: "Numpad0", ctrl: true },
    ],
    run: withRenderer((renderer) => renderer.resetZoom()),
  },
  {
    group: "Help",
    description: "Show shortcuts",
    keys: ["F1", "?"],
    bindings: [{ code: "F1" }, { code: "Slash", shift: true }],
    global: true,
    run: ({ toggleHelp }) => toggleHelp(),
  },
];

/** Mouse gestures, shown in the help overlay only. */
export const mouseControls: { description: string; keys: string[] }[] = [
  { description: "Pan", keys: ["Right / middle drag", "Space + drag"] },
  { description: "Zoom", keys: ["Wheel"] },
  { description: "Select / add / toggle", keys: ["Click", "Shift+click", "Ctrl+click"] },
  { description: "Box select", keys: ["Drag on empty space"] },
  { description: "Connect", keys: ["Drag from a port"] },
  { description: "Add node", keys: ["Drag or click in the palette"] },
];

export function findShortcut(event: KeyboardEvent): Shortcut | undefined {
  const ctrl = event.ctrlKey || event.metaKey;
  const code = physicalKey(event);
  return shortcuts.find((shortcut) =>
    shortcut.bindings.some(
      (binding) =>
        binding.code === code &&
        !!binding.ctrl === ctrl &&
        !!binding.shift === event.shiftKey &&
        !!binding.alt === event.altKey,
    ),
  );
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
