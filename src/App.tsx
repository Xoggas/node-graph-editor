import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Editor, type Notice } from "./app/editor";
import { physicalKey } from "./app/keys";
import { findShortcut, isEditableTarget } from "./app/shortcuts";
import type { GraphRenderer, RendererStats } from "./render/GraphRenderer";
import { ContextMenu, type ContextMenuItem } from "./ui/ContextMenu";
import { buildContextMenu } from "./ui/contextMenuItems";
import { GraphCanvas } from "./ui/GraphCanvas";
import { NodePalette } from "./ui/NodePalette";
import { ProblemsPanel, summary } from "./ui/ProblemsPanel";
import { ResourceBrowser } from "./ui/ResourceBrowser";
import { SearchPanel } from "./ui/SearchPanel";
import { ShortcutHelp } from "./ui/ShortcutHelp";
import "./App.css";

/** Default node size offset so a dropped node is centered under the cursor. */
const DROP_OFFSET = { x: 110, y: 48 };

const STATUS_VISIBLE_MS = 4000;
const TOAST_VISIBLE_MS = 5000;
const MAX_TOASTS = 3;
/** The tab with the graph; the others are resource types of the pack. */
const GRAPH_TAB = "graph";

interface Toast extends Notice {
  id: number;
}

let nextToastId = 1;

const editor = new Editor();
void editor.start();

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

  // Bumped on every Ctrl+F, so pressing it again refocuses and selects the query.
  const [searchRequest, setSearchRequest] = useState(0);
  const closeSearch = useCallback(() => setSearchRequest(0), []);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);

  // Tabs: the graph, then one list per resource type of the pack (in pack.json order).
  const library = useMemo(() => editor.registry.pack?.resources ?? null, [snapshot.pack]);
  const resourceTypes = useMemo(() => (library ? [...library.types.values()] : []), [library]);
  const [tab, setTab] = useState(GRAPH_TAB);
  const resourceType = tab === GRAPH_TAB ? undefined : resourceTypes.find((type) => type.id === tab);
  const activeTab = resourceType ? tab : GRAPH_TAB;
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [resourceFocusRequest, setResourceFocusRequest] = useState(0);
  const showUses = useCallback((nodeIds: string[]) => {
    setTab(GRAPH_TAB);
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.selectViews(nodeIds);
    renderer.frameSelection();
  }, []);

  const onRenderer = useCallback((renderer: GraphRenderer | null) => {
    rendererRef.current?.onContextMenu(null);
    rendererRef.current = renderer;
    renderer?.onContextMenu((request) =>
      setMenu({ x: request.clientX, y: request.clientY, items: buildContextMenu(request, editor, renderer) }),
    );
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
      // Graph commands do nothing on a resource tab, where the graph is hidden.
      const onGraph = activeTabRef.current === GRAPH_TAB;
      if (!onGraph && !shortcut.global) {
        return;
      }
      event.preventDefault();
      shortcut.run(
        {
          editor,
          renderer: onGraph ? rendererRef.current : null,
          toggleHelp: () => setHelpOpen((open) => !open),
          openSearch: () => (onGraph ? setSearchRequest((request) => request + 1) : setResourceFocusRequest((request) => request + 1)),
        },
        event,
      );
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
  // Warnings and errors also pop up over the canvas, where they are hard to miss.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  useEffect(
    () =>
      editor.onNotice((notice) => {
        const toast = { ...notice, id: nextToastId++ };
        // The same message again replaces the old toast instead of stacking a copy.
        setToasts((current) => [...current.filter((other) => other.message !== toast.message), toast].slice(-MAX_TOASTS));
        window.setTimeout(() => dismissToast(toast.id), TOAST_VISIBLE_MS);
      }),
    [dismissToast],
  );
  const unsaved = snapshot.dirty || snapshot.localizationDirty;
  const title = `${documentName}${unsaved ? " *" : ""}`;
  useEffect(() => {
    document.title = `${title} — Node Graph Editor`;
  }, [title]);

  // Shown in the palette header and in the resource lists (their texts follow it too).
  const languageSelect = snapshot.languages.length > 0 && (
    <label className="language-select" title="Language of the texts shown">
      Language
      <select value={snapshot.displayLanguage ?? ""} onChange={(event) => editor.setDisplayLanguage(event.target.value)}>
        {snapshot.languages.map((language) => (
          <option key={language} value={language}>
            {language.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="app">
      <header className="toolbar">
        <button onClick={() => void editor.newGraph()} title="Ctrl+N">New</button>
        <button onClick={() => void editor.open()} title="Ctrl+O">Open</button>
        <button onClick={() => void editor.save()} title="Ctrl+S">Save</button>
        <button onClick={() => void editor.save(true)} title="Ctrl+Shift+S">Save As</button>
        <span className="toolbar-separator" />
        <button
          onClick={(event) => void editor.exportGraph(event.shiftKey)}
          title="Export the engine version of the graph (Ctrl+E; Shift+click or Ctrl+Shift+E to choose the file)"
        >
          Export
        </button>
        <label className="toolbar-check" title="Every save also exports the graph (next to it the first time, then to the last export path)">
          <input type="checkbox" checked={snapshot.autoExport} onChange={(event) => editor.setAutoExport(event.target.checked)} />
          on save
        </label>
        <span className="toolbar-separator" />
        <button onClick={() => editor.undo()} disabled={!snapshot.canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button onClick={() => editor.redo()} disabled={!snapshot.canRedo} title="Ctrl+Y">
          Redo
        </button>
        <span className="toolbar-spacer" />
        <button onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (F1)">
          ?
        </button>
      </header>

      <main className="workspace">
        <div className="canvas-area">
          <GraphCanvas editor={editor} onRenderer={onRenderer} />
          {problemsOpen && (
            <ProblemsPanel
              problems={snapshot.problems}
              loadWarnings={snapshot.warnings}
              onShow={(problem) => {
                const target = problem.viewId ?? problem.nodeId;
                if (target) rendererRef.current?.focusView(target);
              }}
              onClose={() => setProblemsOpen(false)}
            />
          )}
          {searchRequest > 0 && (
            <SearchPanel editor={editor} renderer={() => rendererRef.current} focusRequest={searchRequest} onClose={closeSearch} />
          )}
          {toasts.length > 0 && (
            <div className="toasts" role="status" aria-live="polite">
              {toasts.map((toast) => (
                <div key={toast.id} className={`toast toast-${toast.kind}`} onClick={() => dismissToast(toast.id)} title="Click to dismiss">
                  <span className="toast-icon">{toast.kind === "error" ? "✕" : "⚠"}</span>
                  <span className="toast-message">{toast.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <NodePalette
          descriptors={snapshot.descriptors}
          pack={snapshot.pack}
          packWarnings={snapshot.packWarnings}
          languageSelect={languageSelect || null}
          onDrop={onDrop}
          onAdd={onAdd}
          onChoosePack={() => void editor.choosePackFolder()}
          onReloadPack={() => void editor.reloadPack()}
        />
        {resourceType && library && (
          <ResourceBrowser
            editor={editor}
            library={library}
            type={resourceType}
            language={snapshot.displayLanguage}
            languageSelect={languageSelect || null}
            focusRequest={resourceFocusRequest}
            onShowUses={showUses}
          />
        )}
      </main>

      {/* At the bottom, away from the toolbar buttons. */}
      {resourceTypes.length > 0 && (
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === GRAPH_TAB} className={`tab${activeTab === GRAPH_TAB ? " active" : ""}`} onClick={() => setTab(GRAPH_TAB)}>
            Graph
          </button>
          <span className="tabs-separator" />
          {resourceTypes.map((type) => (
            <button
              key={type.id}
              role="tab"
              aria-selected={activeTab === type.id}
              className={`tab${activeTab === type.id ? " active" : ""}`}
              onClick={() => setTab(type.id)}
              title={`Resource library: ${type.label}`}
            >
              {type.label}
              <span className="tab-count">{[...library!.items.values()].filter((item) => item.type === type.id).length}</span>
            </button>
          ))}
        </nav>
      )}

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
        <span className={`status-message${statusVisible && snapshot.statusKind === "info" ? " visible" : ""}`}>
          {snapshot.statusKind === "info" && snapshot.status}
        </span>
        {(() => {
          const errors = snapshot.problems.filter((problem) => problem.severity === "error").length;
          const warnings = snapshot.problems.length - errors + snapshot.warnings.length;
          return (
            <button
              className={`status-problems${errors > 0 ? " errors" : warnings > 0 ? " warnings" : ""}`}
              onClick={() => setProblemsOpen((open) => !open)}
              title="Graph checks: what would break or look wrong in the game"
            >
              {errors + warnings === 0 ? "✓ No problems" : `${errors > 0 ? "✕" : "⚠"} ${summary(errors, warnings)}`}
            </button>
          );
        })()}
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

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
