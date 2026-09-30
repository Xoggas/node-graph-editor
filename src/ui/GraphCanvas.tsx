import { useEffect, useRef } from "react";
import type { Editor } from "../app/editor";
import { GraphRenderer } from "../render/GraphRenderer";

interface GraphCanvasProps {
  editor: Editor;
  onRenderer: (renderer: GraphRenderer | null) => void;
}

export function GraphCanvas({ editor, onRenderer }: GraphCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const renderer = new GraphRenderer(hostRef.current!, editor);
    let active = true;
    renderer
      .init()
      .then(() => {
        if (!active) return;
        onRenderer(renderer);
        if (import.meta.env.DEV) {
          // Console / test access, like `__editor`.
          (window as unknown as { __renderer: GraphRenderer }).__renderer = renderer;
        }
      })
      .catch((error: unknown) => editor.setStatus(`Renderer failed to start: ${String(error)}`));
    return () => {
      active = false;
      onRenderer(null);
      renderer.destroy();
    };
  }, [editor, onRenderer]);

  return <div ref={hostRef} className="canvas-host" />;
}
