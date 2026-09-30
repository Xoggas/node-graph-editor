import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Editor } from "./app/editor";
import type { GraphRenderer, RendererStats } from "./render/GraphRenderer";
import { GraphCanvas } from "./ui/GraphCanvas";
import { NodePalette } from "./ui/NodePalette";
import "./App.css";

/** Default node size offset so a dropped node is centered under the cursor. */
const DROP_OFFSET = { x: 110, y: 48 };

const editor = new Editor();

export default function App() {
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const [stats, setStats] = useState<RendererStats | null>(null);
  const descriptors = useMemo(() => editor.registry.nodes.descriptors(), []);

  const onRenderer = useCallback((renderer: GraphRenderer | null) => {
    rendererRef.current = renderer;
  }, []);

  const onDrop = useCallback((typeId: string, clientX: number, clientY: number) => {
    const position = rendererRef.current?.clientToGraph(clientX, clientY);
    if (position) {
      editor.addNode(typeId, { x: position.x - DROP_OFFSET.x, y: position.y - DROP_OFFSET.y });
    }
  }, []);

  const onAdd = useCallback((typeId: string) => {
    const center = rendererRef.current?.viewCenter() ?? { x: 0, y: 0 };
    const position = { x: center.x - DROP_OFFSET.x, y: center.y - DROP_OFFSET.y };
    // Cascade repeated clicks so new nodes do not hide each other.
    const occupied = (x: number, y: number) =>
      [...editor.graph.nodes].some((node) => Math.abs(node.position.x - x) < 1 && Math.abs(node.position.y - y) < 1);
    while (occupied(position.x, position.y)) {
      position.x += 24;
      position.y += 24;
    }
    editor.addNode(typeId, position);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const renderer = rendererRef.current;
      setStats(renderer ? renderer.getStats() : null);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        void editor.save(event.shiftKey);
      } else if (key === "o") {
        event.preventDefault();
        void editor.open();
      } else if (key === "n") {
        event.preventDefault();
        void editor.newGraph();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const title = `${snapshot.fileName ?? "Untitled"}${snapshot.dirty ? " *" : ""}`;
  useEffect(() => {
    document.title = `${title} — Node Graph Editor`;
  }, [title]);

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void editor.newGraph()} title="Ctrl+N">New</button>
        <button onClick={() => void editor.open()} title="Ctrl+O">Open</button>
        <button onClick={() => void editor.save()} title="Ctrl+S">Save</button>
        <button onClick={() => void editor.save(true)} title="Ctrl+Shift+S">Save As</button>
        <span className="toolbar-separator" />
        <button onClick={() => rendererRef.current?.frameAll()} title="F">Frame All</button>
        <button onClick={() => void editor.generateStressGraph(1000)} title="Replace the graph with 1000 generated nodes">
          Stress 1000
        </button>
        <span className="toolbar-title">{title}</span>
      </header>

      <main className="workspace">
        <GraphCanvas editor={editor} onRenderer={onRenderer} />
        <NodePalette descriptors={descriptors} onDrop={onDrop} onAdd={onAdd} />
      </main>

      <footer className="statusbar">
        <span className="status-message">{snapshot.status}</span>
        {snapshot.warnings.length > 0 && (
          <span className="status-warnings" title={snapshot.warnings.join("\n")}>
            ⚠ {snapshot.warnings.length} warning(s)
          </span>
        )}
        <span className="status-stat">
          {snapshot.nodeCount} nodes · {snapshot.connectionCount} connections
          {snapshot.selectionCount > 0 && ` · ${snapshot.selectionCount} selected`}
        </span>
        {stats && (
          <span className="status-stat" title="CPU time of the last rendered frames; visible elements after culling">
            {stats.frameMs.toFixed(1)} ms/frame · {stats.visibleNodes}/{snapshot.nodeCount} visible
          </span>
        )}
      </footer>
    </div>
  );
}
