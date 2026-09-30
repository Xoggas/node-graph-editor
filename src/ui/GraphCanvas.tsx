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
      .then(() => active && onRenderer(renderer))
      .catch((error: unknown) => editor.setStatus(`Renderer failed to start: ${String(error)}`));
    return () => {
      active = false;
      onRenderer(null);
      renderer.destroy();
    };
  }, [editor, onRenderer]);

  return <div ref={hostRef} className="canvas-host" />;
}
