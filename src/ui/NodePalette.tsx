import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { PackInfo } from "../app/editor";
import type { NodeDescriptor } from "../graph/registry";
import { t } from "../i18n";

interface NodePaletteProps {
  descriptors: readonly NodeDescriptor[];
  pack: PackInfo | null;
  packWarnings: readonly string[];
  /** The language switch, on its own row above the pack name. */
  languageSelect: ReactNode;
  /** Drop at a client position; the host decides whether it landed on the canvas. */
  onDrop: (schemaId: string, clientX: number, clientY: number) => void;
  /** Click without dragging. */
  onAdd: (schemaId: string) => void;
  /** The same for the sticky note item. */
  onDropNote: (clientX: number, clientY: number) => void;
  onAddNote: () => void;
  onChoosePack: () => void;
  onReloadPack: () => void;
}

/** What is dragged: a node type, or a sticky note. */
type PaletteEntry = { kind: "node"; descriptor: NodeDescriptor } | { kind: "note" };

interface DragState {
  entry: PaletteEntry;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

export function NodePalette({
  descriptors,
  pack,
  packWarnings,
  languageSelect,
  onDrop,
  onAdd,
  onDropNote,
  onAddNote,
  onChoosePack,
  onReloadPack,
}: NodePaletteProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!drag) {
      return;
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD;
      setDrag({ ...drag, x: event.clientX, y: event.clientY, moved });
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      setDrag(null);
      const { entry } = drag;
      if (entry.kind === "note") {
        if (drag.moved) onDropNote(event.clientX, event.clientY);
        else onAddNote();
      } else if (drag.moved) {
        onDrop(entry.descriptor.schemaId, event.clientX, event.clientY);
      } else {
        onAdd(entry.descriptor.schemaId);
      }
    };
    const cancel = () => setDrag(null);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [drag, onDrop, onAdd, onDropNote, onAddNote]);

  const startDrag = (entry: PaletteEntry, event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setDrag({ entry, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, moved: false });
  };
  const dragging = (entry: PaletteEntry) =>
    drag !== null &&
    (drag.entry.kind === "note" ? entry.kind === "note" : entry.kind === "node" && entry.descriptor === drag.entry.descriptor);

  const groups = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const visible = query
      ? descriptors.filter((d) => `${d.title} ${d.schemaId} ${d.menu}`.toLowerCase().includes(query))
      : descriptors;
    const byMenu = new Map<string, NodeDescriptor[]>();
    for (const descriptor of visible) {
      const list = byMenu.get(descriptor.menu) ?? [];
      list.push(descriptor);
      byMenu.set(descriptor.menu, list);
    }
    return [...byMenu.entries()];
  }, [descriptors, filter]);

  return (
    <aside className="palette">
      <div className="palette-pack">
        {languageSelect}
        <div className="palette-pack-name" title={pack?.source}>
          {pack ? pack.name : t("No schema pack")}
          {pack && <span className="palette-pack-version">v{pack.version}</span>}
        </div>
        <div className="palette-pack-actions">
          <button onClick={onChoosePack} title={t("Choose a schema pack folder (with pack.json)")}>
            {t("Pack…")}
          </button>
          <button onClick={onReloadPack} title={t("Reload the schema pack from disk")}>
            {t("Reload")}
          </button>
          {packWarnings.length > 0 && (
            <span className="palette-pack-warnings" title={packWarnings.join("\n\n")}>
              ⚠ {packWarnings.length}
            </span>
          )}
        </div>
      </div>
      <div className="palette-extras">
        <div
          className={`palette-item palette-note${drag?.entry.kind === "note" ? " dragging" : ""}`}
          title={`${t("A comment on the canvas, not part of the dialogue")}\n${t("Drag onto the canvas, or click to add at the view center")}`}
          onPointerDown={(event) => startDrag({ kind: "note" }, event)}
        >
          <span className="palette-note-icon" aria-hidden="true" />
          <div className="palette-item-title">{t("Sticky note")}</div>
        </div>
      </div>
      <input
        className="palette-filter"
        placeholder={t("Filter…")}
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="palette-list">
        {groups.map(([menu, items]) => (
          <section key={menu || "(root)"} className="palette-group">
            {menu && <div className="palette-group-title">{menu}</div>}
            {items.map((descriptor) => (
              <div
                key={descriptor.schemaId}
                className={`palette-item${dragging({ kind: "node", descriptor }) ? " dragging" : ""}`}
                style={descriptor.color !== null ? { borderLeftColor: toCss(descriptor.color) } : undefined}
                title={`${descriptor.schemaId}\n${t("Drag onto the canvas, or click to add at the view center")}`}
                onPointerDown={(event) => startDrag({ kind: "node", descriptor }, event)}
              >
                <div className="palette-item-title">{descriptor.title}</div>
              </div>
            ))}
          </section>
        ))}
        {groups.length === 0 && (
          <div className="palette-empty">{descriptors.length === 0 ? t("The schema pack has no nodes.") : t("No matching nodes.")}</div>
        )}
      </div>
      {drag?.moved && (
        <div className="palette-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.entry.kind === "note" ? t("Sticky note") : drag.entry.descriptor.title}
        </div>
      )}
    </aside>
  );
}

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
