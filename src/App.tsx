import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { onUiLanguageChange, t, uiLanguage } from "./i18n";
import { Editor, type Notice, type PasteMode, type PasteModeQuestion } from "./app/editor";
import { NOTE_DEFAULT_SIZE } from "./graph/types";
import { physicalKey } from "./app/keys";
import { findShortcut, isEditableTarget } from "./app/shortcuts";
import type { GraphRenderer, RendererStats } from "./render/GraphRenderer";
import { ContextMenu, type ContextMenuItem } from "./ui/ContextMenu";
import { buildContextMenu } from "./ui/contextMenuItems";
import { GraphCanvas } from "./ui/GraphCanvas";
import { NodePalette } from "./ui/NodePalette";
import { ProblemsPanel, summary } from "./ui/ProblemsPanel";
import { LocalizationTable } from "./ui/LocalizationTable";
import { PasteModeDialog } from "./ui/PasteModeDialog";
import { SettingsDialog } from "./ui/SettingsDialog";
import { ResourceBrowser } from "./ui/ResourceBrowser";
import { SearchPanel } from "./ui/SearchPanel";
import { ShortcutHelp } from "./ui/ShortcutHelp";
import "./App.css";

/** Default node size offset so a dropped node is centered under the cursor. */
const DROP_OFFSET = { x: 110, y: 48 };

const STATUS_VISIBLE_MS = 4000;
const TOAST_VISIBLE_MS = 5000;
/** How long a toast fades out before it is removed (matches `toast-out` in App.css). */
const TOAST_LEAVE_MS = 200;
const MAX_TOASTS = 3;
/** "true" when the status bar shows frame time and drawn nodes. */
const SHOW_DEBUG_KEY = "node-graph-editor.showDebug";

function readShowDebug(): boolean {
  try {
    return localStorage.getItem(SHOW_DEBUG_KEY) === "true";
  } catch {
    return false;
  }
}

/** The tab with the graph; the others are the localization table and resource types of the pack. */
const GRAPH_TAB = "graph";
/** Not a valid resource type id, so it cannot clash with one. */
const LOCALIZATION_TAB = "@localization";

interface Toast extends Notice {
  id: number;
  /** Fading out, about to be removed. */
  leaving?: boolean;
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
  // Re-render everything in the new interface language.
  useSyncExternalStore(onUiLanguageChange, uiLanguage);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const [showDebug, setShowDebug] = useState(readShowDebug);
  const changeShowDebug = useCallback((on: boolean) => {
    setShowDebug(on);
    try {
      localStorage.setItem(SHOW_DEBUG_KEY, String(on));
    } catch {
      // Only a convenience.
    }
  }, []);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const [stats, setStats] = useState<RendererStats | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const helpOpenRef = useRef(helpOpen);
  helpOpenRef.current = helpOpen;

  // The question before pasting nodes with unique names (see `Editor.setPasteModeAsker`).
  const [pasteQuestion, setPasteQuestion] = useState<{ question: PasteModeQuestion; answer: (mode: PasteMode | null) => void } | null>(null);
  const pasteQuestionRef = useRef(pasteQuestion);
  pasteQuestionRef.current = pasteQuestion;
  useEffect(() => {
    editor.setPasteModeAsker(
      (question) =>
        new Promise((resolve) => {
          pasteQuestionRef.current?.answer(null);
          setPasteQuestion({ question, answer: resolve });
        }),
    );
    return () => editor.setPasteModeAsker(null);
  }, []);
  const answerPaste = useCallback((mode: PasteMode | null) => {
    pasteQuestionRef.current?.answer(mode);
    setPasteQuestion(null);
  }, []);

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
  const hasLocalization = snapshot.languages.length > 0;
  const activeTab = resourceType || (tab === LOCALIZATION_TAB && hasLocalization) ? tab : GRAPH_TAB;
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

  // A dropped note is centered under the cursor; a clicked one goes to the view center.
  const onDropNote = useCallback((clientX: number, clientY: number) => {
    const renderer = rendererRef.current;
    const position = renderer?.clientToGraph(clientX, clientY);
    if (renderer && position) {
      renderer.addNoteAt({ x: position.x - NOTE_DEFAULT_SIZE.width / 2, y: position.y - NOTE_DEFAULT_SIZE.height / 2 });
    }
  }, []);
  const onAddNote = useCallback(() => rendererRef.current?.addNoteAtPointer(), []);

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
      // Dialogs handle their own keys; nothing else runs meanwhile.
      if (pasteQuestionRef.current || settingsOpenRef.current) return;
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
      if (!onGraph && !shortcut.global && !shortcut.anyTab) {
        return;
      }
      event.preventDefault();
      shortcut.run(
        {
          editor,
          renderer: onGraph ? rendererRef.current : null,
          toggleHelp: () => setHelpOpen((open) => !open),
          openSettings: () => setSettingsOpen(true),
          openSearch: () => (onGraph ? setSearchRequest((request) => request + 1) : setResourceFocusRequest((request) => request + 1)),
        },
        event,
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const documentName = snapshot.fileName ?? t("Untitled");

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
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)));
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), TOAST_LEAVE_MS);
  }, []);
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
    <label className="language-select" title={t("Language of the texts shown")}>
      {t("Language")}
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
        <button onClick={() => void editor.newGraph()} title="Ctrl+N">{t("New")}</button>
        <button onClick={() => void editor.open()} title="Ctrl+O">{t("Open")}</button>
        <button onClick={() => void editor.save()} title="Ctrl+S">{t("Save")}</button>
        <button onClick={() => void editor.save(true)} title="Ctrl+Shift+S">{t("Save As")}</button>
        <span className="toolbar-separator" />
        <button
          onClick={(event) => void editor.exportGraph(event.shiftKey)}
          title={t("Export the engine version of the graph (Ctrl+E; Shift+click or Ctrl+Shift+E to choose the file)")}
        >
          {t("Export")}
        </button>
        <span className="toolbar-separator" />
        <button onClick={() => editor.undo()} disabled={!snapshot.canUndo} title="Ctrl+Z">
          {t("Undo")}
        </button>
        <button onClick={() => editor.redo()} disabled={!snapshot.canRedo} title="Ctrl+Y">
          {t("Redo")}
        </button>
        <span className="toolbar-spacer" />
        <button className="toolbar-settings" onClick={() => setSettingsOpen(true)} title={t("Settings (Ctrl+,)")}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M9.4 1l.3 1.9c.5.2 1 .5 1.4.8l1.8-.7 1.4 2.4-1.5 1.2c.1.5.1 1.1 0 1.6l1.5 1.2-1.4 2.4-1.8-.7c-.4.3-.9.6-1.4.8L9.4 15H6.6l-.3-1.9c-.5-.2-1-.5-1.4-.8l-1.8.7-1.4-2.4 1.5-1.2a4.6 4.6 0 0 1 0-1.6L1.7 6.6l1.4-2.4 1.8.7c.4-.3.9-.6 1.4-.8L6.6 1h2.8zM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"
            />
          </svg>
          {t("Settings")}
        </button>
        <button onClick={() => setHelpOpen(true)} title={t("Keyboard shortcuts (F1)")}>
          ?
        </button>
      </header>

      <main className="workspace">
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
        <div className="canvas-area">
          <GraphCanvas editor={editor} onRenderer={onRenderer} />
          {searchRequest > 0 && (
            <SearchPanel editor={editor} renderer={() => rendererRef.current} focusRequest={searchRequest} onClose={closeSearch} />
          )}
          {toasts.length > 0 && (
            <div className="toasts" role="status" aria-live="polite">
              {toasts.map((toast) => (
                <div key={toast.id} className={`toast toast-${toast.kind}${toast.leaving ? " leaving" : ""}`} onClick={() => dismissToast(toast.id)} title={t("Click to dismiss")}>
                  <span className="toast-icon">{toast.kind === "error" ? "✕" : toast.kind === "success" ? "✓" : "⚠"}</span>
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
          onDropNote={onDropNote}
          onAddNote={onAddNote}
          onChoosePack={() => void editor.choosePackFolder()}
          onReloadPack={() => void editor.reloadPack()}
        />
        {activeTab === LOCALIZATION_TAB && (
          <LocalizationTable
            editor={editor}
            languages={snapshot.languages}
            focusRequest={resourceFocusRequest}
            onShowUses={showUses}
          />
        )}
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
      {(resourceTypes.length > 0 || hasLocalization) && (
        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === GRAPH_TAB} className={`tab${activeTab === GRAPH_TAB ? " active" : ""}`} onClick={() => setTab(GRAPH_TAB)}>
            {t("Graph")}
          </button>
          {hasLocalization && (
            <button
              role="tab"
              aria-selected={activeTab === LOCALIZATION_TAB}
              className={`tab${activeTab === LOCALIZATION_TAB ? " active" : ""}`}
              onClick={() => setTab(LOCALIZATION_TAB)}
              title={t("Localization tables of the pack")}
            >
              {t("Localization")}
            </button>
          )}
          {resourceTypes.length > 0 && <span className="tabs-separator" />}
          {resourceTypes.map((type) => (
            <button
              key={type.id}
              role="tab"
              aria-selected={activeTab === type.id}
              className={`tab${activeTab === type.id ? " active" : ""}`}
              onClick={() => setTab(type.id)}
              title={t("Resource library: {type}", { type: type.label })}
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
              ? [snapshot.dirty && t("The graph has unsaved changes."), snapshot.localizationDirty && t("Localization texts have unsaved changes.")]
                  .filter(Boolean)
                  .join("\n")
              : t("All changes saved")
          }
        >
          <span className="status-document-label">{t("Graph:")}</span>
          <span className="status-document-name">{documentName}</span>
          {unsaved && (
            <span className="status-document-dirty">{snapshot.localizationDirty && !snapshot.dirty ? t("● unsaved texts") : t("● unsaved")}</span>
          )}
        </span>
        <span className="status-path" title={snapshot.filePath ?? undefined}>
          <bdi>{snapshot.filePath ?? (snapshot.fileName ? t("{name} (not on disk)", { name: snapshot.fileName }) : t("Not saved yet"))}</bdi>
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
              title={t("Graph checks: what would break or look wrong in the game")}
            >
              {errors + warnings === 0 ? t("✓ No problems") : `${errors > 0 ? "✕" : "⚠"} ${summary(errors, warnings)}`}
            </button>
          );
        })()}
        <span className="status-stat">
          {t("{nodes} nodes · {connections} connections", { nodes: snapshot.nodeCount, connections: snapshot.connectionCount })}
          {snapshot.selectionCount > 0 && ` · ${t("{count} selected", { count: snapshot.selectionCount })}`}
        </span>
        {stats && showDebug && (
          <span className="status-stat" title={t("CPU time of the last rendered frames; visible elements after culling")}>
            {t("{ms} ms/frame · {visible}/{total} visible", { ms: stats.frameMs.toFixed(1), visible: stats.visibleNodes, total: snapshot.nodeCount })}
          </span>
        )}
      </footer>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}

      {pasteQuestion && <PasteModeDialog question={pasteQuestion.question} onAnswer={answerPaste} />}

      {settingsOpen && (
        <SettingsDialog
          autoExport={snapshot.autoExport}
          onAutoExportChange={(on) => editor.setAutoExport(on)}
          showDebug={showDebug}
          onShowDebugChange={changeShowDebug}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
