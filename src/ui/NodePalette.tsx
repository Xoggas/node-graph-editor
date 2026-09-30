import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { PackInfo } from "../app/editor";
import type { NodeDescriptor } from "../graph/registry";

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
  onChoosePack: () => void;
  onReloadPack: () => void;
}

interface DragState {
  descriptor: NodeDescriptor;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

export function NodePalette({ descriptors, pack, packWarnings, languageSelect, onDrop, onAdd, onChoosePack, onReloadPack }: NodePaletteProps) {
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
      if (drag.moved) {
        onDrop(drag.descriptor.schemaId, event.clientX, event.clientY);
      } else {
        onAdd(drag.descriptor.schemaId);
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
  }, [drag, onDrop, onAdd]);

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
          {pack ? pack.name : "No schema pack"}
          {pack && <span className="palette-pack-version">v{pack.version}</span>}
        </div>
        <div className="palette-pack-actions">
          <button onClick={onChoosePack} title="Choose a schema pack folder (with pack.json)">
            Pack…
          </button>
          <button onClick={onReloadPack} title="Reload the schema pack from disk">
            Reload
          </button>
          {packWarnings.length > 0 && (
            <span className="palette-pack-warnings" title={packWarnings.join("\n\n")}>
              ⚠ {packWarnings.length}
            </span>
          )}
        </div>
      </div>
      <input
        className="palette-filter"
        placeholder="Filter…"
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
                className={`palette-item${drag?.descriptor === descriptor ? " dragging" : ""}`}
                style={descriptor.color !== null ? { borderLeftColor: toCss(descriptor.color) } : undefined}
                title={`${descriptor.schemaId}\nDrag onto the canvas, or click to add at the view center`}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  setDrag({
                    descriptor,
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    x: event.clientX,
                    y: event.clientY,
                    moved: false,
                  });
                }}
              >
                <div className="palette-item-title">{descriptor.title}</div>
              </div>
            ))}
          </section>
        ))}
        {groups.length === 0 && (
          <div className="palette-empty">{descriptors.length === 0 ? "The schema pack has no nodes." : "No matching nodes."}</div>
        )}
      </div>
      {drag?.moved && (
        <div className="palette-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.descriptor.title}
        </div>
      )}
    </aside>
  );
}

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
