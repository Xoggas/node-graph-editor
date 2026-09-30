import { useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem =
  /** A row of color choices. */
  | { swatches: { color: string; label: string; current: boolean; action: () => void }[] }
  | {
      label: string;
      /** Key hint shown on the right, e.g. "Ctrl+L". */
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      action: () => void;
    }
  | "separator";

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const EDGE_MARGIN = 8;

/** A popup menu at a client position; closes on a pick, an outside press, Esc, wheel or window blur. */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu inside the window: open to the left / upwards near the edges.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: x + width + EDGE_MARGIN > window.innerWidth ? Math.max(EDGE_MARGIN, x - width) : x,
      top: y + height + EDGE_MARGIN > window.innerHeight ? Math.max(EDGE_MARGIN, y - height) : y,
    });
  }, [x, y]);

  useLayoutEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Esc closes the menu only; it must not also clear the selection.
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onClose, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onClose, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="context-menu" role="menu" style={position} onContextMenu={(event) => event.preventDefault()}>
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={index} className="context-menu-separator" role="separator" />
        ) : "swatches" in item ? (
          <div key={index} className="context-menu-swatches" role="group">
            {item.swatches.map((swatch) => (
              <button
                key={swatch.label}
                className={`context-menu-swatch${swatch.current ? " current" : ""}`}
                role="menuitemradio"
                aria-checked={swatch.current}
                title={swatch.label}
                style={{ background: swatch.color }}
                onClick={() => {
                  onClose();
                  swatch.action();
                }}
              />
            ))}
          </div>
        ) : (
          <button
            key={index}
            className={`context-menu-item${item.danger ? " danger" : ""}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
