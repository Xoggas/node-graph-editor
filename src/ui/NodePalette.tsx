import { useEffect, useState } from "react";
import type { NodeDescriptor } from "../graph/registry";

interface NodePaletteProps {
  descriptors: NodeDescriptor[];
  /** Drop at a client position; the host decides whether it landed on the canvas. */
  onDrop: (typeId: string, clientX: number, clientY: number) => void;
  /** Click without dragging. */
  onAdd: (typeId: string) => void;
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

export function NodePalette({ descriptors, onDrop, onAdd }: NodePaletteProps) {
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
        onDrop(drag.descriptor.typeId, event.clientX, event.clientY);
      } else {
        onAdd(drag.descriptor.typeId);
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

  const query = filter.trim().toLowerCase();
  const visible = query
    ? descriptors.filter((d) => `${d.displayName} ${d.typeId} ${d.menuPath}`.toLowerCase().includes(query))
    : descriptors;

  return (
    <aside className="palette">
      <div className="palette-title">Nodes</div>
      <input
        className="palette-filter"
        placeholder="Filter…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <div className="palette-list">
        {visible.map((descriptor) => (
          <div
            key={descriptor.typeId}
            className={`palette-item${drag?.descriptor === descriptor ? " dragging" : ""}`}
            title="Drag onto the canvas, or click to add at the view center"
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
            <div className="palette-item-title">{descriptor.displayName}</div>
            <div className="palette-item-type">{descriptor.menuPath || descriptor.typeId}</div>
          </div>
        ))}
        {visible.length === 0 && <div className="palette-empty">No matching nodes.</div>}
      </div>
      {drag?.moved && (
        <div className="palette-ghost" style={{ left: drag.x, top: drag.y }}>
          {drag.descriptor.displayName}
        </div>
      )}
    </aside>
  );
}
