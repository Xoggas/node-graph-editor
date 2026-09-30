import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Editor } from "./app/editor";
import { physicalKey } from "./app/keys";
import { findShortcut, isEditableTarget } from "./app/shortcuts";
import type { GraphRenderer, RendererStats } from "./render/GraphRenderer";
import { GraphCanvas } from "./ui/GraphCanvas";
import { NodePalette } from "./ui/NodePalette";
import { ShortcutHelp } from "./ui/ShortcutHelp";
import "./App.css";

/** Default node size offset so a dropped node is centered under the cursor. */
const DROP_OFFSET = { x: 110, y: 48 };

const STATUS_VISIBLE_MS = 4000;

const editor = new Editor();
void editor.loadInitialPack();

if (import.meta.env.DEV) {
  // Console access for manual checks, e.g. `__editor.generateStressGraph(1000)`.
  (window as unknown as { __editor: Editor }).__editor = editor;
}

export default function App() {
  const snapshot = useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const [stats, setStats] = useState<RendererStats | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;

  const onRenderer = useCallback((renderer: GraphRenderer | null) => {
    rendererRef.current = renderer;
  }, []);

  const onDrop = useCallback((schemaId: string, clientX: number, clientY: number) => {
    const position = rendererRef.current?.clientToGraph(clientX, clientY);
    if (position) {
      editor.addNode(schemaId, { x: position.x - DROP_OFFSET.x, y: position.y - DROP_OFFSET.y });
    }
  }, []);

  const onAdd = useCallback((schemaId: string) => {
    const center = rendererRef.current?.viewCenter() ?? { x: 0, y: 0 };
    const position = { x: center.x - DROP_OFFSET.x, y: center.y - DROP_OFFSET.y };
    // Cascade repeated clicks so new nodes do not hide each other.
    const occupied = (x: number, y: number) =>
      [...editor.graph.nodes].some((node) => Math.abs(node.position.x - x) < 1 && Math.abs(node.position.y - y) < 1);
    while (occupied(position.x, position.y)) {
      position.x += 24;
      position.y += 24;
    }
    editor.addNode(schemaId, position);
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
      if (helpOpenRef.current && physicalKey(event) === "Escape") {
        event.preventDefault();
        setHelpOpen(false);
        return;
      }
      const shortcut = findShortcut(event);
      if (!shortcut || (!shortcut.global && isEditableTarget(event.target))) {
        return;
      }
      event.preventDefault();
      shortcut.run({ editor, renderer: rendererRef.current, toggleHelp: () => setHelpOpen((open) => !open) }, event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const documentName = snapshot.fileName ?? "Untitled";

  // Status messages are transient: shown for a few seconds after each change.
  const [statusVisible, setStatusVisible] = useState(false);
  useEffect(() => {
    if (snapshot.statusId === 0 || !snapshot.status) {
      return;
    }
    setStatusVisible(true);
    const timer = window.setTimeout(() => setStatusVisible(false), STATUS_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [snapshot.statusId, snapshot.status]);
  const unsaved = snapshot.dirty || snapshot.localizationDirty;
  const title = `${documentName}${unsaved ? " *" : ""}`;
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
        <button onClick={() => editor.undo()} disabled={!snapshot.canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button onClick={() => editor.redo()} disabled={!snapshot.canRedo} title="Ctrl+Y">
          Redo
        </button>
        <span className="toolbar-spacer" />
        {snapshot.languages.length > 0 && (
          <label className="toolbar-language" title="Language shown on nodes">
            Text
            <select value={snapshot.displayLanguage ?? ""} onChange={(event) => editor.setDisplayLanguage(event.target.value)}>
              {snapshot.languages.map((language) => (
                <option key={language} value={language}>
                  {language.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (F1)">
          ?
        </button>
      </header>

      <main className="workspace">
        <GraphCanvas editor={editor} onRenderer={onRenderer} />
        <NodePalette
          descriptors={snapshot.descriptors}
          pack={snapshot.pack}
          packWarnings={snapshot.packWarnings}
          onDrop={onDrop}
          onAdd={onAdd}
          onChoosePack={() => void editor.choosePackFolder()}
          onReloadPack={() => void editor.reloadPack()}
        />
      </main>

      <footer className="statusbar">
        <span
          className="status-document"
          title={
            unsaved
              ? [snapshot.dirty && "The graph has unsaved changes.", snapshot.localizationDirty && "Localization texts have unsaved changes."]
                  .filter(Boolean)
                  .join("\n")
              : "All changes saved"
          }
        >
          <span className="status-document-label">Graph:</span>
          <span className="status-document-name">{documentName}</span>
          {unsaved && <span className="status-document-dirty">● unsaved{snapshot.localizationDirty && !snapshot.dirty ? " texts" : ""}</span>}
        </span>
        <span className="status-path" title={snapshot.filePath ?? undefined}>
          <bdi>{snapshot.filePath ?? (snapshot.fileName ? `${snapshot.fileName} (not on disk)` : "Not saved yet")}</bdi>
        </span>
        <span className={`status-message${statusVisible ? " visible" : ""}`}>{snapshot.status}</span>
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

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
