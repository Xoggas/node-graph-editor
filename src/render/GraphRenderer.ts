import { Application, Container, Graphics } from "pixi.js";
import type { Editor, GraphReplacedOptions } from "../app/editor";
import type { GraphChange, GraphModel } from "../graph/graph";
import { clampZoom, type Connection, NOTE_DEFAULT_SIZE, type Port, type Size, type Vec2, type Viewport } from "../graph/types";
import { DotGrid } from "./DotGrid";
import { EdgeView, traceEdgePath } from "./EdgeView";
import { type Bounds, computeEdgePath, edgeIntersectsBounds, hitTestEdge, rectsIntersect } from "./geometry";
import { clampNumber } from "../graph/schema";
import { localizationKey } from "../graph/localization";
import { physicalKey } from "../app/keys";
import { resourcesOfType } from "../graph/resources";
import { ImageCache } from "./ImageCache";
import { InlineEditor } from "./InlineEditor";
import { choiceRouteConnections } from "../graph/choices";
import { NodeTooltip } from "./NodeTooltip";
import { getIn, itemRefCandidates, itemRefLabel, nodeRefCandidates } from "../graph/dataOps";
import { type Control, formatNumber, INFO_KEY, type NodeHit, NodeView, type PortHighlight } from "./NodeView";
import { NOTE_LINE_HEIGHT, NOTE_TEXT_SIZE, type NoteHit, NoteView } from "./NoteView";
import { installFonts } from "./text";
import { theme, typeColor } from "./theme";

/**
 * Below this zoom nodes switch to the simplified look (colored block + name, see `NodeView.setOverview`).
 * 0 keeps full details at every zoom.
 */
const DETAIL_ZOOM = 0;
/** Zoomed out, node names are re-fitted only on these zoom steps. */
const OVERVIEW_ZOOM_STEP = 1.12;
/** `focusView` zooms in to at least this, so the focused node is readable. */
const FOCUS_MIN_ZOOM = 0.75;
/** Edges keep at least this on-screen width (px) when zoomed out. */
const MIN_EDGE_SCREEN_WIDTH = 1.3;
const EDGE_BASE_WIDTH = 2.25;
const BOX_SELECT_THRESHOLD = 4;
/** Max CPU time per frame spent re-stroking edges after a zoom step; the rest continues next frame. */
const EDGE_RESTYLE_BUDGET_MS = 6;

type Hit =
  | { kind: "node"; view: NodeView; hit: NodeHit }
  | { kind: "edge"; view: EdgeView }
  | { kind: "note"; view: NoteView; hit: NoteHit };

type Interaction =
  | { kind: "none" }
  /** `moved` tells a right-button drag (pan) from a right click (context menu). */
  | { kind: "pan"; pointerId: number; button: number; moved: boolean; start: Vec2; startViewport: Viewport }
  | {
      kind: "drag";
      pointerId: number;
      start: Vec2;
      origins: Map<string, Vec2>;
      /** Edges with both ends inside the dragged group: translated instead of rebuilt. */
      internalEdges: Set<string>;
      applied: Vec2;
    }
  | { kind: "connect"; pointerId: number; from: Port; fromView: NodeView; cursor: Vec2; target: { port: Port; view: NodeView } | null }
  | {
      kind: "box";
      pointerId: number;
      start: Vec2;
      current: Vec2;
      mode: "replace" | "add" | "toggle";
      initial: Set<string>;
      initialEdges: Set<string>;
    }
  /** Dragging a note's folded corner. */
  | { kind: "resize"; pointerId: number; view: NoteView; start: Vec2; origin: Size }
  /** Pressing a checkbox or an enum segment; applied on release over the same target. */
  | { kind: "press"; pointerId: number; view: NodeView; control: Control; segment: number | null };

/** What a right click hit; the selection is already updated to include it. */
export type ContextTarget =
  | { kind: "node"; viewId: string }
  | { kind: "note"; noteId: string }
  | { kind: "edge"; connectionId: string }
  | { kind: "canvas" };

export interface ContextMenuRequest {
  clientX: number;
  clientY: number;
  /** Graph position of the click, e.g. to paste there. */
  world: Vec2;
  target: ContextTarget;
}

/** Pointer travel (px) after which a right-button press becomes a pan instead of a click. */
const CLICK_SLOP = 4;

export interface RendererStats {
  frameMs: number;
  visibleNodes: number;
  visibleEdges: number;
}

export class GraphRenderer {
  private readonly app = new Application();
  private readonly grid = new DotGrid();
  private readonly world = new Container();
  /** Sticky notes lie under the connections and nodes. */
  private readonly noteLayer = new Container();
  private readonly edgeLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly preview = new Graphics();
  private readonly overlay = new Graphics();

  private graph!: GraphModel;
  // Views are keyed by view id: the node id for a node, the alias id for a linked copy.
  private unsubscribeGraph: () => void = () => {};
  private unsubscribeEditor: () => void = () => {};
  private unsubscribeLocalization: () => void = () => {};
  private readonly nodeViews = new Map<string, NodeView>();
  private readonly viewsByContainer = new Map<Container, NodeView>();
  private readonly edgeViews = new Map<string, EdgeView>();
  private readonly noteViews = new Map<string, NoteView>();
  private readonly notesByContainer = new Map<Container, NoteView>();
  private hoveredNote: NoteView | null = null;
  /** Selected view ids (nodes, linked copies and notes). */
  private readonly selection = new Set<string>();
  /** Other views of the selected nodes, drawn highlighted. */
  private linkHighlights = new Set<string>();
  /** Selected connections by id. */
  private readonly selectedEdges = new Map<string, EdgeView>();
  private hovered: NodeView | null = null;
  private interaction: Interaction = { kind: "none" };
  private highlightCache = new Map<string, PortHighlight>();
  /** Connections on routes from lines to the choices they show get dashed (see `choiceRouteConnections`). */
  private choiceRoutesDirty = true;
  /** `<view id>|<port id>` of the ports those connections start or end at: drawn with a ring. */
  private choiceRoutePorts = new Set<string>();

  private viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  private screen = { width: 1, height: 1 };
  /** Quantized zoom of the zoomed-out node look, or null while node details are shown. */
  private overviewZoom: number | null = null;
  private edgeScale = 1;
  private applyingViewport = false;
  private spaceDown = false;
  private pointer: Vec2 = { x: 0, y: 0 };
  private pointerInside = false;

  private readonly dirtyEdges = new Set<string>();
  private readonly restyleEdges = new Set<string>();
  private translatingEdges: ReadonlySet<string> = new Set();
  private allEdgesDirty = false;
  private gridDirty = true;
  private overlayDirty = false;
  private frameRequested = false;
  private initialized = false;
  private destroyed = false;
  private resizeObserver: ResizeObserver | null = null;
  private inlineEditor!: InlineEditor;
  private tooltip!: NodeTooltip;
  private readonly images = new ImageCache<NodeView>(
    (path) => this.editor.readResource(path),
    (views) => {
      for (const view of views) {
        if (this.nodeViews.get(view.viewId) !== view) continue;
        if (view.container.visible) view.rebuild();
        else view.staleLayout = true;
      }
      this.requestFrame();
    },
  );
  /** Node being edited inline, so the editor closes if the node disappears. */
  private editedNode: NodeView | null = null;
  private contextMenuListener: ((request: ContextMenuRequest) => void) | null = null;
  private readonly frameTimes: number[] = [];
  private visibleNodes = 0;
  private visibleEdges = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly editor: Editor,
  ) {}

  async init(): Promise<void> {
    await this.app.init({
      background: theme.canvasBackground,
      antialias: true,
      autoStart: false,
      sharedTicker: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true, { children: true });
      return;
    }
    this.app.ticker?.stop();
    installFonts();

    const stage = this.app.stage;
    stage.eventMode = "none";
    stage.interactiveChildren = false;
    stage.addChild(this.grid.sprite, this.world, this.overlay);
    this.world.addChild(this.noteLayer, this.edgeLayer, this.nodeLayer, this.preview);

    const canvas = this.app.canvas;
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    this.host.appendChild(canvas);
    this.inlineEditor = new InlineEditor(this.host);
    this.tooltip = new NodeTooltip(this.host);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", preventDefault);
    canvas.addEventListener("dblclick", this.onDoubleClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();

    this.initialized = true;
    this.setGraph(this.editor.graph, { frameAll: false });
    this.unsubscribeEditor = this.editor.onGraphReplaced((graph, options) => this.setGraph(graph, options));
    this.unsubscribeLocalization = this.editor.onLocalizationChanged((change) => this.refreshTexts(change?.key ?? null));
  }

  destroy(): void {
    this.destroyed = true;
    if (!this.initialized) {
      return;
    }
    this.inlineEditor.close(false);
    this.unsubscribeGraph();
    this.unsubscribeEditor();
    this.unsubscribeLocalization();
    this.resizeObserver?.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.grid.destroy();
    this.app.destroy(true, { children: true });
  }

  getStats(): RendererStats {
    const frameMs = this.frameTimes.length === 0 ? 0 : this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    return { frameMs, visibleNodes: this.visibleNodes, visibleEdges: this.visibleEdges };
  }

  /** Converts a client (window) position to graph coordinates, or null when outside the canvas. */
  clientToGraph(clientX: number, clientY: number): Vec2 | null {
    if (!this.initialized) {
      return null;
    }
    const rect = this.app.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return null;
    }
    return this.screenToWorld({ x, y });
  }

  viewCenter(): Vec2 {
    return this.screenToWorld({ x: this.screen.width / 2, y: this.screen.height / 2 });
  }

  frameAll(): void {
    this.frameNodes([...this.nodeViews.keys(), ...this.noteViews.keys()]);
  }

  /** Frames the selection, or the whole graph when nothing is selected. */
  frameSelection(): void {
    if (this.selection.size > 0) this.frameNodes(this.selection);
    else this.frameAll();
  }

  private frameNodes(nodeIds: Iterable<string>): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of nodeIds) {
      const view = this.nodeViews.get(id) ?? this.noteViews.get(id);
      if (!view) {
        continue;
      }
      const { x, y, width, height } = view.rect;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    }
    if (minX === Infinity) {
      this.setViewport({ x: this.screen.width / 2, y: this.screen.height / 2, zoom: 1 });
      return;
    }
    const padding = 48;
    const zoom = clampZoom(
      Math.min(
        (this.screen.width - padding * 2) / Math.max(1, maxX - minX),
        (this.screen.height - padding * 2) / Math.max(1, maxY - minY),
        1,
      ),
    );
    this.setViewport({
      x: (this.screen.width - (maxX - minX) * zoom) / 2 - minX * zoom,
      y: (this.screen.height - (maxY - minY) * zoom) / 2 - minY * zoom,
      zoom,
    });
  }

  /** Zooms around the pointer when it is over the canvas, otherwise around the view center. */
  zoomBy(factor: number): void {
    const anchor = this.pointerInside ? this.pointer : { x: this.screen.width / 2, y: this.screen.height / 2 };
    this.zoomAround(anchor, this.viewport.zoom * factor);
  }

  resetZoom(): void {
    this.zoomAround({ x: this.screen.width / 2, y: this.screen.height / 2 }, 1);
  }

  private zoomAround(anchor: Vec2, targetZoom: number): void {
    const zoom = clampZoom(targetZoom);
    if (zoom === this.viewport.zoom) {
      return;
    }
    const ratio = zoom / this.viewport.zoom;
    this.setViewport({
      x: anchor.x - (anchor.x - this.viewport.x) * ratio,
      y: anchor.y - (anchor.y - this.viewport.y) * ratio,
      zoom,
    });
  }

  onContextMenu(listener: ((request: ContextMenuRequest) => void) | null): void {
    this.contextMenuListener = listener;
  }

  /** True when the view can be renamed (its node's schema allows custom names). */
  canRename(viewId: string): boolean {
    return !!this.graph.viewNode(viewId)?.schema?.naming.editable;
  }

  /** Opens the rename field on the only selected node, or the text of the only selected note. */
  renameSelection(): boolean {
    const [viewId] = this.selection;
    const note = this.selection.size === 1 ? this.noteViews.get(viewId) : undefined;
    if (note) {
      this.openNoteEditor(note);
      return true;
    }
    const view = this.selection.size === 1 ? this.nodeViews.get(viewId) : undefined;
    if (!view || !this.canRename(viewId)) {
      this.editor.setStatus(view ? "This node has no editable name." : "Select one node to rename.");
      return false;
    }
    this.openRenameEditor(view);
    return true;
  }

  /** True while a mouse gesture (drag, connect, pan, box select) is in progress. */
  isInteracting(): boolean {
    return this.interaction.kind !== "none";
  }

  /** Graph position of the pointer when it is over the canvas. */
  pointerPosition(): Vec2 | null {
    return this.pointerInside ? this.screenToWorld(this.pointer) : null;
  }

  selectedViewIds(): string[] {
    return [...this.selection];
  }

  selectedConnectionIds(): string[] {
    return [...this.selectedEdges.keys()];
  }

  /** Selects nodes, linked copies and notes by id. */
  selectViews(viewIds: Iterable<string>): void {
    this.setEdgeSelection(new Set());
    const ids = new Set([...viewIds].filter((id) => this.nodeViews.has(id) || this.noteViews.has(id)));
    this.setSelection(ids);
    this.bringToFront(ids);
  }

  selectAll(): void {
    this.selectViews([...this.nodeViews.keys(), ...this.noteViews.keys()]);
  }

  /** Adds a sticky note with its top-left corner at `world`, selects it and opens its text. */
  addNoteAt(world: Vec2): void {
    const id = this.editor.addNote({ x: Math.round(world.x), y: Math.round(world.y) });
    this.selectViews([id]);
    const view = this.noteViews.get(id);
    if (view) this.openNoteEditor(view);
  }

  /** Adds a note centered under the pointer (or the view center). */
  addNoteAtPointer(): void {
    const center = this.pointerPosition() ?? this.viewCenter();
    this.addNoteAt({ x: center.x - NOTE_DEFAULT_SIZE.width / 2, y: center.y - NOTE_DEFAULT_SIZE.height / 2 });
  }

  /** Opens the text of a note for editing. */
  editNote(noteId: string): void {
    const view = this.noteViews.get(noteId);
    if (view) this.openNoteEditor(view);
  }

  clearSelection(): void {
    this.setSelection(new Set());
    this.setEdgeSelection(new Set());
  }

  nudgeSelection(dx: number, dy: number): void {
    for (const id of this.selection) {
      const position = this.graph.viewPosition(id);
      if (position) {
        this.graph.moveView(id, { x: position.x + dx, y: position.y + dy });
      }
    }
  }

  /**
   * Selects a view and centers it, zooming in far enough to read it when the view is zoomed out.
   */
  focusView(viewId: string): void {
    const view = this.nodeViews.get(viewId);
    if (!view) return;
    this.selectViews([viewId]);
    const { x, y, width, height } = view.rect;
    const zoom = Math.max(this.viewport.zoom, FOCUS_MIN_ZOOM);
    this.setViewport({ x: this.screen.width / 2 - (x + width / 2) * zoom, y: this.screen.height / 2 - (y + height / 2) * zoom, zoom });
  }

  /** Selects the next view of the selected node (the node, then its linked copies) and pans to it. */
  goToNextLinkedView(): boolean {
    const current = this.selection.size === 1 ? [...this.selection][0] : null;
    const node = current ? this.graph.viewNode(current) : undefined;
    const views = node ? this.graph.viewIdsOf(node.id) : [];
    if (!current || views.length < 2) {
      this.editor.setStatus("Select a node with linked copies.");
      return false;
    }
    const next = views[(views.indexOf(current) + 1) % views.length];
    this.focusView(next);
    this.editor.setStatus(next === node!.id ? "Original node." : `Linked copy ${views.indexOf(next)} of ${views.length - 1}.`);
    return true;
  }

  deleteSelection(): void {
    const nodeIds = [...this.selection];
    const connectionIds = [...this.selectedEdges.keys()];
    if (nodeIds.length === 0 && connectionIds.length === 0) {
      return;
    }
    this.setSelection(new Set());
    this.setEdgeSelection(new Set());
    this.editor.deleteElements(nodeIds, connectionIds);
  }

  // --- Graph binding -----------------------------------------------------------

  private setGraph(graph: GraphModel, options: GraphReplacedOptions): void {
    this.inlineEditor.close(false);
    this.tooltip.hide();
    if (graph.registry !== this.graph?.registry) {
      // A new pack may have different files behind the same paths.
      this.images.clear();
    }
    this.unsubscribeGraph();
    this.graph = graph;
    this.unsubscribeGraph = graph.subscribe(this.onGraphChange);
    if (this.interaction.kind === "drag" || this.interaction.kind === "resize") {
      this.editor.endInteraction();
    }
    this.interaction = { kind: "none" };
    this.rebuildAll();
    if (options.frameAll) {
      this.frameAll();
    } else {
      this.viewport = { ...graph.viewport };
      this.applyViewport(false);
    }
  }

  private rebuildAll(): void {
    this.choiceRoutesDirty = true;
    for (const view of this.nodeViews.values()) {
      view.destroy();
    }
    for (const view of this.edgeViews.values()) {
      view.destroy();
    }
    for (const view of this.noteViews.values()) {
      view.destroy();
    }
    this.noteViews.clear();
    this.notesByContainer.clear();
    this.hoveredNote = null;
    this.nodeViews.clear();
    this.viewsByContainer.clear();
    this.edgeViews.clear();
    this.dirtyEdges.clear();
    this.restyleEdges.clear();
    this.translatingEdges = new Set();
    this.selection.clear();
    this.selectedEdges.clear();
    this.hovered = null;
    this.linkHighlights = new Set();
    for (const node of this.graph.nodes) {
      this.addNodeView(node.id);
    }
    for (const alias of this.graph.aliases) {
      this.addNodeView(alias.id);
    }
    for (const note of this.graph.notes) {
      this.addNoteView(note.id);
    }
    for (const connection of this.graph.connections) {
      this.addEdgeView(connection);
    }
    this.allEdgesDirty = true;
    this.editor.setSelectionCount(0);
    this.requestFrame();
  }

  private readonly onGraphChange = (change: GraphChange): void => {
    if (change.kind !== "viewportChanged" && change.kind !== "nodeMoved" && change.kind !== "aliasMoved" && !change.kind.startsWith("note")) {
      this.choiceRoutesDirty = true;
    }
    switch (change.kind) {
      case "nodeAdded":
        this.addNodeView(change.node.id);
        this.refreshReferences(change.node.id);
        break;
      case "nodeRemoved":
        this.removeNodeView(change.node.id);
        this.refreshReferences(change.node.id);
        break;
      case "nodeMoved": {
        this.nodeViews.get(change.node.id)?.syncPosition();
        this.markNodeEdgesDirty(change.node.id);
        break;
      }
      case "aliasAdded":
        this.addNodeView(change.alias.id);
        this.rebuildViewsOf(change.alias.nodeId);
        break;
      case "aliasRemoved":
        this.removeNodeView(change.alias.id);
        this.rebuildViewsOf(change.alias.nodeId);
        break;
      case "aliasMoved":
        this.nodeViews.get(change.alias.id)?.syncPosition();
        this.markNodeEdgesDirty(change.alias.nodeId);
        break;
      case "nodeDataChanged":
      case "nodeRenamed":
        this.rebuildViewsOf(change.node.id);
        this.markNodeEdgesDirty(change.node.id);
        this.refreshReferences(change.node.id);
        break;
      case "nodePortsChanged":
        this.rebuildViewsOf(change.node.id);
        this.markNodeEdgesDirty(change.node.id);
        break;
      case "connectionAdded":
        this.addEdgeView(change.connection);
        this.redrawNodes(change.connection);
        break;
      case "connectionRemoved": {
        const view = this.edgeViews.get(change.connection.id);
        if (view) {
          if (this.selectedEdges.delete(change.connection.id)) {
            this.updateSelectionCount();
          }
          view.destroy();
          this.edgeViews.delete(change.connection.id);
          this.dirtyEdges.delete(change.connection.id);
          this.restyleEdges.delete(change.connection.id);
        }
        this.redrawNodes(change.connection);
        break;
      }
      case "noteAdded":
        this.addNoteView(change.note.id);
        break;
      case "noteRemoved":
        this.removeNoteView(change.note.id);
        break;
      case "noteMoved":
        this.noteViews.get(change.note.id)?.syncPosition();
        break;
      case "noteChanged":
        this.noteViews.get(change.note.id)?.redraw();
        break;
      case "viewportChanged":
        if (!this.applyingViewport) {
          this.viewport = { ...this.graph.viewport };
          this.applyViewport(false);
        }
        break;
      case "reset":
        this.rebuildAll();
        break;
    }
    this.requestFrame();
  };

  /** Adds the view of a node or of an alias. */
  private addNodeView(viewId: string): void {
    const node = this.graph.viewNode(viewId);
    if (!node || this.nodeViews.has(viewId)) {
      return;
    }
    const view = new NodeView(node, {
      isPortOnChoiceRoute: (portId) => this.choiceRoutePorts.has(`${viewId}|${portId}`),
      isPortConnected: (portId) => {
        for (const connection of this.graph.getPortConnections(portId)) {
          if ((connection.outputPortId === portId ? connection.outputViewId : connection.inputViewId) === viewId) return true;
        }
        return false;
      },
      aliasCount: () => this.graph.aliasesOf(node.id).length,
      portHighlight: (port) => this.portHighlight(port, viewId),
      portColor: (typeId) => this.portColor(typeId),
      resources: () => this.graph.registry.pack?.resources ?? null,
      localizedText: (field, path, value) => {
        const key = localizationKey(node, field, path, value);
        const language = this.editor.getSnapshot().displayLanguage;
        return { key, language, text: key && language ? this.editor.localization.get(language, key) : undefined };
      },
      image: (path, view) => this.images.get(path, view),
      referenceLabel: (field, id) =>
        field.type === "nodeRef" ? (this.graph.getNode(id)?.displayName ?? null) : itemRefLabel(this.graph, id),
    }, this.graph.getAlias(viewId) ?? null);
    view.setOverview(this.overviewZoom);
    view.linkHighlighted = this.linkHighlights.has(viewId);
    this.nodeViews.set(viewId, view);
    this.viewsByContainer.set(view.container, view);
    this.nodeLayer.addChild(view.container);
  }

  private removeNodeView(viewId: string): void {
    const view = this.nodeViews.get(viewId);
    if (!view) {
      return;
    }
    if (this.hovered === view) {
      this.hovered = null;
      this.tooltip.hide();
    }
    if (this.editedNode === view) {
      this.inlineEditor.close(false);
    }
    if (this.selection.delete(viewId)) {
      this.editor.setSelectionCount(this.selection.size);
      this.updateLinkHighlights();
    }
    this.linkHighlights.delete(viewId);
    this.viewsByContainer.delete(view.container);
    this.nodeViews.delete(viewId);
    view.destroy();
  }

  private addNoteView(noteId: string): void {
    const note = this.graph.getNote(noteId);
    if (!note || this.noteViews.has(noteId)) return;
    const view = new NoteView(note);
    this.noteViews.set(noteId, view);
    this.notesByContainer.set(view.container, view);
    this.noteLayer.addChild(view.container);
  }

  private removeNoteView(noteId: string): void {
    const view = this.noteViews.get(noteId);
    if (!view) return;
    if (this.hoveredNote === view) this.hoveredNote = null;
    if (view.editing) this.inlineEditor.close(false);
    if (this.selection.delete(noteId)) this.updateSelectionCount();
    this.noteViews.delete(noteId);
    this.notesByContainer.delete(view.container);
    view.destroy();
  }

  /** Rebuilds every view of a node (the node and its linked copies). */
  private rebuildViewsOf(nodeId: string): void {
    for (const viewId of this.graph.viewIdsOf(nodeId)) {
      this.nodeViews.get(viewId)?.rebuild();
    }
  }

  private addEdgeView(connection: Connection): void {
    const output = this.graph.getPort(connection.outputPortId);
    const view = new EdgeView(connection, output ? this.portColor(output.typeId) : theme.connection);
    this.edgeViews.set(connection.id, view);
    this.edgeLayer.addChild(view.graphics);
    this.dirtyEdges.add(connection.id);
  }

  private markNodeEdgesDirty(nodeId: string): void {
    for (const connection of this.graph.getNodeConnections(nodeId)) {
      if (!this.translatingEdges.has(connection.id)) {
        this.dirtyEdges.add(connection.id);
      }
    }
  }

  /** Port dots show where a port is connected, so every view of both nodes is redrawn. */
  private redrawNodes(connection: Connection): void {
    for (const viewId of [...this.graph.viewIdsOf(connection.outputNodeId), ...this.graph.viewIdsOf(connection.inputNodeId)]) {
      this.nodeViews.get(viewId)?.redraw();
    }
  }

  private refreshEdge(view: EdgeView): void {
    const { connection } = view;
    const source = this.nodeViews.get(connection.outputViewId);
    const target = this.nodeViews.get(connection.inputViewId);
    const start = source?.portWorldPosition(connection.outputPortId);
    const end = target?.portWorldPosition(connection.inputPortId);
    view.update(start && end ? computeEdgePath(start, end, source!.rect, target!.rect) : null, this.edgeScale);
  }

  // --- Frame loop ----------------------------------------------------------------

  private requestFrame(): void {
    if (this.frameRequested || !this.initialized || this.destroyed) {
      return;
    }
    this.frameRequested = true;
    requestAnimationFrame(this.frame);
  }

  /** Renders on demand: nothing is redrawn while the graph and the view are idle. */
  private readonly frame = (): void => {
    this.frameRequested = false;
    if (this.destroyed) {
      return;
    }
    const started = performance.now();

    if (this.choiceRoutesDirty) {
      this.choiceRoutesDirty = false;
      this.updateChoiceRoutes();
    }

    if (this.allEdgesDirty) {
      this.allEdgesDirty = false;
      this.dirtyEdges.clear();
      this.edgeViews.forEach((view) => this.refreshEdge(view));
    } else if (this.dirtyEdges.size > 0) {
      for (const id of this.dirtyEdges) {
        const view = this.edgeViews.get(id);
        if (view) {
          this.refreshEdge(view);
        }
      }
      this.dirtyEdges.clear();
    }
    if (this.restyleEdges.size > 0) {
      this.restyleEdgesWithinBudget(started);
    }
    this.cull();
    if (this.gridDirty) {
      this.gridDirty = false;
      this.drawGrid();
    }
    this.drawPreview();
    if (this.overlayDirty) {
      this.overlayDirty = false;
      this.drawOverlay();
    }
    this.app.render();

    this.frameTimes.push(performance.now() - started);
    if (this.frameTimes.length > 30) {
      this.frameTimes.shift();
    }
  };

  /**
   * Dashes the connections that lead from lines to the choices they show and rings their ports;
   * restyles only what changed.
   */
  private updateChoiceRoutes(): void {
    const routes = choiceRouteConnections(this.graph);
    const ports = new Set<string>();
    for (const [id, view] of this.edgeViews) {
      const dashed = routes.has(id);
      if (dashed) {
        const { connection } = view;
        ports.add(`${connection.outputViewId}|${connection.outputPortId}`);
        ports.add(`${connection.inputViewId}|${connection.inputPortId}`);
      }
      if (view.dashed !== dashed) {
        view.dashed = dashed;
        this.restyleEdges.add(id);
      }
    }
    const changedViews = new Set<string>();
    for (const key of ports) if (!this.choiceRoutePorts.has(key)) changedViews.add(key.split("|")[0]);
    for (const key of this.choiceRoutePorts) if (!ports.has(key)) changedViews.add(key.split("|")[0]);
    this.choiceRoutePorts = ports;
    for (const viewId of changedViews) {
      const view = this.nodeViews.get(viewId);
      if (!view) continue;
      if (view.container.visible) view.redraw();
      else view.stale = true;
    }
  }

  private restyleEdgesWithinBudget(started: number): void {
    let processed = 0;
    for (const id of this.restyleEdges) {
      this.restyleEdges.delete(id);
      this.edgeViews.get(id)?.redraw(this.edgeScale);
      if (++processed % 32 === 0 && performance.now() - started > EDGE_RESTYLE_BUDGET_MS) {
        break;
      }
    }
    if (this.restyleEdges.size > 0) {
      this.requestFrame();
    }
  }

  private cull(): void {
    const view = this.visibleWorldBounds(24);
    let visibleNodes = 0;
    for (const nodeView of this.nodeViews.values()) {
      const { x, y, width, height } = nodeView.rect;
      const visible = rectsIntersect({ minX: x, minY: y, maxX: x + width, maxY: y + height }, view);
      nodeView.container.visible = visible;
      if (visible) {
        visibleNodes++;
        if (nodeView.overviewZoom !== this.overviewZoom) {
          nodeView.setOverview(this.overviewZoom);
        }
        if (nodeView.staleLayout) {
          nodeView.stale = false;
          nodeView.rebuild();
          // The size may have changed (e.g. a longer text), so its connections are re-routed.
          this.markNodeEdgesDirty(nodeView.node.id);
          this.requestFrame();
        } else if (nodeView.stale) {
          nodeView.stale = false;
          nodeView.redraw();
        }
      }
    }
    for (const noteView of this.noteViews.values()) {
      const { x, y, width, height } = noteView.rect;
      noteView.container.visible = rectsIntersect({ minX: x - 4, minY: y - 4, maxX: x + width + 4, maxY: y + height + 6 }, view);
    }
    let visibleEdges = 0;
    for (const edgeView of this.edgeViews.values()) {
      const visible = rectsIntersect(edgeView.bounds, view);
      edgeView.graphics.visible = visible;
      visibleEdges += visible ? 1 : 0;
    }
    this.visibleNodes = visibleNodes;
    this.visibleEdges = visibleEdges;
  }

  private drawGrid(): void {
    this.grid.update(this.viewport);
  }

  private drawPreview(): void {
    const g = this.preview;
    g.clear();
    if (this.interaction.kind !== "connect") {
      return;
    }
    const { from, fromView, cursor, target } = this.interaction;
    const fromPosition = fromView.portWorldPosition(from.id);
    if (!fromPosition) {
      return;
    }
    const other = (target && target.view.portWorldPosition(target.port.id)) || cursor;
    const [start, end] = from.direction === "Output" ? [fromPosition, other] : [other, fromPosition];
    traceEdgePath(g, computeEdgePath(start, end));
    g.stroke({ width: 2.5 * this.edgeScale, color: this.portColor(from.typeId), alpha: target ? 1 : 0.75, cap: "round" });
  }

  private drawOverlay(): void {
    const g = this.overlay;
    g.clear();
    if (this.interaction.kind !== "box") {
      return;
    }
    const { start, current } = this.interaction;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    g.rect(x, y, Math.abs(current.x - start.x), Math.abs(current.y - start.y))
      .fill(theme.selectionFill)
      .stroke({ width: 1, ...theme.selectionStroke });
  }

  // --- Viewport ------------------------------------------------------------------

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.screen = { width, height };
    this.app.renderer.resize(width, height);
    this.grid.resize(width, height);
    this.gridDirty = true;
    this.requestFrame();
  }

  private setViewport(viewport: Viewport): void {
    this.viewport = { x: viewport.x, y: viewport.y, zoom: clampZoom(viewport.zoom) };
    this.applyViewport(true);
  }

  private applyViewport(commit: boolean): void {
    const { x, y, zoom } = this.viewport;
    this.world.position.set(x, y);
    this.world.scale.set(zoom);
    this.gridDirty = true;
    this.inlineEditor?.close(true);
    this.tooltip?.hide();

    // Nodes switch look lazily: visible ones in `cull`, the rest once they scroll into view.
    this.overviewZoom = zoom >= DETAIL_ZOOM ? null : Math.pow(OVERVIEW_ZOOM_STEP, Math.round(Math.log(zoom) / Math.log(OVERVIEW_ZOOM_STEP)));

    // Keep edges readable when zoomed out; quantized so edges are only rebuilt on a few zoom steps.
    const wanted = Math.max(1, MIN_EDGE_SCREEN_WIDTH / (EDGE_BASE_WIDTH * zoom));
    const edgeScale = wanted <= 1 ? 1 : Math.pow(1.3, Math.ceil(Math.log(wanted) / Math.log(1.3)));
    if (edgeScale !== this.edgeScale) {
      this.edgeScale = edgeScale;
      this.edgeViews.forEach((_, id) => this.restyleEdges.add(id));
    }

    if (commit) {
      this.applyingViewport = true;
      try {
        this.graph.setViewport(this.viewport);
      } finally {
        this.applyingViewport = false;
      }
    }
    this.requestFrame();
  }

  private screenToWorld(point: Vec2): Vec2 {
    return {
      x: (point.x - this.viewport.x) / this.viewport.zoom,
      y: (point.y - this.viewport.y) / this.viewport.zoom,
    };
  }

  private visibleWorldBounds(paddingPx: number): Bounds {
    const { x, y, zoom } = this.viewport;
    return {
      minX: (-paddingPx - x) / zoom,
      minY: (-paddingPx - y) / zoom,
      maxX: (this.screen.width + paddingPx - x) / zoom,
      maxY: (this.screen.height + paddingPx - y) / zoom,
    };
  }

  // --- Selection -------------------------------------------------------------------

  private setSelection(next: Set<string>): void {
    for (const id of this.selection) {
      if (!next.has(id)) {
        this.setNodeSelected(id, false);
      }
    }
    for (const id of next) {
      if (!this.selection.has(id)) {
        this.setNodeSelected(id, true);
      }
    }
    this.selection.clear();
    next.forEach((id) => this.selection.add(id));
    this.updateSelectionCount();
    this.updateLinkHighlights();
    this.requestFrame();
  }

  /** Highlights the other views (original / linked copies) of the selected nodes. */
  private updateLinkHighlights(): void {
    const next = new Set<string>();
    for (const id of this.selection) {
      const node = this.graph.viewNode(id);
      if (!node) continue;
      for (const viewId of this.graph.viewIdsOf(node.id)) {
        if (!this.selection.has(viewId)) next.add(viewId);
      }
    }
    for (const id of new Set([...this.linkHighlights, ...next])) {
      const view = this.nodeViews.get(id);
      const highlighted = next.has(id);
      if (view && view.linkHighlighted !== highlighted) {
        view.linkHighlighted = highlighted;
        view.redraw();
      }
    }
    this.linkHighlights = next;
  }

  private setNodeSelected(nodeId: string, selected: boolean): void {
    const view = this.nodeViews.get(nodeId) ?? this.noteViews.get(nodeId);
    if (view && view.selected !== selected) {
      view.selected = selected;
      view.redraw();
    }
  }

  /** Replaces the selected connections (by id); selected edges are drawn on top. */
  private setEdgeSelection(next: Set<string>): void {
    for (const [id, view] of this.selectedEdges) {
      if (next.has(id)) continue;
      view.selected = false;
      view.redraw(this.edgeScale);
      this.selectedEdges.delete(id);
    }
    for (const id of next) {
      const view = this.edgeViews.get(id);
      if (!view || this.selectedEdges.has(id)) continue;
      view.selected = true;
      view.redraw(this.edgeScale);
      this.edgeLayer.addChild(view.graphics);
      this.selectedEdges.set(id, view);
    }
    this.updateSelectionCount();
    this.requestFrame();
  }

  private updateSelectionCount(): void {
    this.editor.setSelectionCount(this.selection.size + this.selectedEdges.size);
  }

  private bringToFront(nodeIds: Iterable<string>): void {
    for (const id of nodeIds) {
      const view = this.nodeViews.get(id);
      if (view) {
        this.nodeLayer.addChild(view.container);
      }
      const note = this.noteViews.get(id);
      if (note) {
        this.noteLayer.addChild(note.container);
      }
    }
  }

  // --- Hit testing -----------------------------------------------------------------

  private hitTest(world: Vec2, includeEdges = true): Hit | null {
    const portRadius = Math.max(9, 7 / this.viewport.zoom);
    const children = this.nodeLayer.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const view = this.viewsByContainer.get(children[i]);
      if (!view) {
        continue;
      }
      const { x, y, width, height } = view.rect;
      if (world.x < x - portRadius || world.y < y || world.x > x + width + portRadius || world.y > y + height) {
        continue;
      }
      const hit = view.hitTest(world.x - x, world.y - y, portRadius);
      if (hit) {
        return { kind: "node", view, hit };
      }
    }
    if (includeEdges) {
      const tolerance = 6 / this.viewport.zoom;
      const views = [...this.edgeViews.values()];
      for (let i = views.length - 1; i >= 0; i--) {
        const view = views[i];
        const b = view.bounds;
        if (view.path && world.x >= b.minX && world.x <= b.maxX && world.y >= b.minY && world.y <= b.maxY) {
          if (hitTestEdge(view.path, world, tolerance)) {
            return { kind: "edge", view };
          }
        }
      }
    }
    // Notes lie under everything else.
    const notes = this.noteLayer.children;
    for (let i = notes.length - 1; i >= 0; i--) {
      const view = this.notesByContainer.get(notes[i]);
      if (!view) continue;
      const hit = view.hitTest(world.x - view.note.position.x, world.y - view.note.position.y);
      if (hit) {
        return { kind: "note", view, hit };
      }
    }
    return null;
  }

  /** Whether `port` of view `viewId` can take the connection being dragged (capacity counts per view). */
  private portHighlight(port: Port, viewId: string): PortHighlight {
    if (this.interaction.kind !== "connect") {
      return "normal";
    }
    const cacheKey = `${viewId}|${port.id}`;
    let highlight = this.highlightCache.get(cacheKey);
    if (highlight === undefined) {
      const { from, fromView } = this.interaction;
      if (port.id === from.id && viewId === fromView.viewId) {
        highlight = "compatible";
      } else if (port.direction === from.direction) {
        highlight = "incompatible";
      } else {
        const [output, input] = from.direction === "Output" ? [from, port] : [port, from];
        const views = from.direction === "Output" ? { output: fromView.viewId, input: viewId } : { output: viewId, input: fromView.viewId };
        highlight = this.graph.canConnect(output.id, input.id, views) === null ? "compatible" : "incompatible";
      }
      this.highlightCache.set(cacheKey, highlight);
    }
    return highlight;
  }

  /** Redraws visible nodes now and marks the rest to redraw once they scroll into view. */
  private invalidateAllNodes(): void {
    this.highlightCache.clear();
    for (const view of this.nodeViews.values()) {
      if (view.container.visible) {
        view.redraw();
      } else {
        view.stale = true;
      }
    }
    this.requestFrame();
  }

  private setHovered(view: NodeView | null, portId: string | null, controlKey: string | null, segment: number | null = null): void {
    if (this.hovered && this.hovered !== view) {
      const previous = this.hovered;
      previous.hovered = false;
      previous.hoveredPortId = null;
      previous.hoveredControl = null;
      previous.hoveredSegment = null;
      previous.redraw();
    }
    this.hovered = view;
    if (
      view &&
      (!view.hovered || view.hoveredPortId !== portId || view.hoveredControl !== controlKey || view.hoveredSegment !== segment)
    ) {
      view.hovered = true;
      view.hoveredPortId = portId;
      view.hoveredControl = controlKey;
      view.hoveredSegment = segment;
      view.redraw();
    }
    this.requestFrame();
  }

  // --- Pointer input ---------------------------------------------------------------

  private localPoint(event: MouseEvent): Vec2 {
    const rect = this.app.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.interaction.kind !== "none") {
      return;
    }
    const point = this.localPoint(event);
    const world = this.screenToWorld(point);
    const canvas = this.app.canvas;
    this.tooltip.hide();
    // Suppress the compatibility mousedown, which would move focus away from an inline editor we open below.
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }

    if (event.button === 1 || event.button === 2 || (event.button === 0 && this.spaceDown)) {
      event.preventDefault();
      this.interaction = {
        kind: "pan",
        pointerId: event.pointerId,
        button: event.button,
        moved: false,
        start: point,
        startViewport: { ...this.viewport },
      };
      canvas.setPointerCapture(event.pointerId);
      // A right press may still become a click (context menu): show the grab cursor once it moves.
      if (event.button !== 2) canvas.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const hit = this.hitTest(world);
    const additive = event.shiftKey;
    const toggle = event.ctrlKey || event.metaKey;

    if (hit?.kind === "node" && hit.hit.kind === "port") {
      this.setEdgeSelection(new Set());
      this.interaction = { kind: "connect", pointerId: event.pointerId, from: hit.hit.port, fromView: hit.view, cursor: world, target: null };
      this.invalidateAllNodes();
      this.editor.setStatus(`Connecting from ${hit.hit.port.displayName}...`);
    } else if (hit?.kind === "note") {
      const noteId = hit.view.id;
      if (hit.hit === "resize" && !toggle && !additive) {
        this.setEdgeSelection(new Set());
        this.setSelection(new Set([noteId]));
        this.bringToFront([noteId]);
        this.editor.beginInteraction();
        this.interaction = { kind: "resize", pointerId: event.pointerId, view: hit.view, start: world, origin: { ...hit.view.note.size } };
      } else {
        this.pressSelect(noteId, toggle, additive);
        if (this.selection.has(noteId)) this.startDrag(event.pointerId, world);
      }
    } else if (hit?.kind === "node") {
      const nodeId = hit.view.viewId;
      this.pressSelect(nodeId, toggle, additive);

      if (hit.hit.kind === "control") {
        const { control, segment } = hit.hit;
        if (control.type === "field" && control.kind !== "bool" && control.kind !== "segmented") {
          this.openFieldEditor(hit.view, control);
          return;
        }
        // Checkboxes, segments, list buttons and matrix cells act on release over the same target.
        this.interaction = { kind: "press", pointerId: event.pointerId, view: hit.view, control, segment };
      } else if (this.selection.has(nodeId)) {
        this.startDrag(event.pointerId, world);
      }
    } else if (hit?.kind === "edge") {
      const id = hit.view.connection.id;
      if (toggle) {
        const next = new Set(this.selectedEdges.keys());
        if (!next.delete(id)) next.add(id);
        this.setEdgeSelection(next);
      } else if (additive) {
        this.setEdgeSelection(new Set([...this.selectedEdges.keys(), id]));
      } else {
        this.setSelection(new Set());
        this.setEdgeSelection(new Set([id]));
      }
    } else {
      const mode = toggle ? "toggle" : additive ? "add" : "replace";
      if (mode === "replace") {
        this.setSelection(new Set());
        this.setEdgeSelection(new Set());
      }
      this.interaction = {
        kind: "box",
        pointerId: event.pointerId,
        start: point,
        current: point,
        mode,
        initial: new Set(this.selection),
        initialEdges: new Set(this.selectedEdges.keys()),
      };
    }

    if (this.interaction.kind !== "none") {
      canvas.setPointerCapture(event.pointerId);
    }
    this.requestFrame();
  };

  /** Click selection of a node or note: Ctrl toggles, Shift adds; a plain click keeps a selection it is in. */
  private pressSelect(id: string, toggle: boolean, additive: boolean): void {
    // Shift / Ctrl keep selected connections, like selected nodes.
    if (!toggle && !additive) this.setEdgeSelection(new Set());
    if (toggle) {
      const next = new Set(this.selection);
      if (!next.delete(id)) {
        next.add(id);
      }
      this.setSelection(next);
    } else if (additive) {
      this.setSelection(new Set([...this.selection, id]));
    } else if (!this.selection.has(id)) {
      this.setSelection(new Set([id]));
    }
  }

  /** Starts moving the selection (nodes, linked copies and notes) with the pointer. */
  private startDrag(pointerId: number, world: Vec2): void {
    this.bringToFront(this.selection);
    const origins = new Map<string, Vec2>();
    const internalEdges = new Set<string>();
    for (const id of this.selection) {
      const position = this.graph.viewPosition(id);
      if (!position) continue;
      origins.set(id, { ...position });
      const node = this.graph.viewNode(id);
      if (!node) continue;
      for (const connection of this.graph.getNodeConnections(node.id)) {
        if (this.selection.has(connection.outputViewId) && this.selection.has(connection.inputViewId)) {
          internalEdges.add(connection.id);
        }
      }
    }
    this.translatingEdges = internalEdges;
    this.editor.beginInteraction();
    this.interaction = { kind: "drag", pointerId, start: world, origins, internalEdges, applied: { x: 0, y: 0 } };
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    this.pointer = point;
    this.pointerInside = true;
    const world = this.screenToWorld(point);
    const interaction = this.interaction;

    switch (interaction.kind) {
      case "none":
        this.updateHover(world);
        return;
      case "pan":
        if (event.pointerId === interaction.pointerId) {
          if (!interaction.moved) {
            if (Math.hypot(point.x - interaction.start.x, point.y - interaction.start.y) < CLICK_SLOP) return;
            interaction.moved = true;
            this.app.canvas.style.cursor = "grabbing";
          }
          this.setViewport({
            x: interaction.startViewport.x + point.x - interaction.start.x,
            y: interaction.startViewport.y + point.y - interaction.start.y,
            zoom: interaction.startViewport.zoom,
          });
        }
        return;
      case "drag": {
        if (event.pointerId !== interaction.pointerId) {
          return;
        }
        const dx = world.x - interaction.start.x;
        const dy = world.y - interaction.start.y;
        for (const [id, origin] of interaction.origins) {
          this.graph.moveView(id, { x: origin.x + dx, y: origin.y + dy });
        }
        const stepX = dx - interaction.applied.x;
        const stepY = dy - interaction.applied.y;
        interaction.applied = { x: dx, y: dy };
        for (const id of interaction.internalEdges) {
          this.edgeViews.get(id)?.translate(stepX, stepY);
        }
        return;
      }
      case "connect": {
        if (event.pointerId !== interaction.pointerId) {
          return;
        }
        interaction.cursor = world;
        const hit = this.hitTest(world, false);
        const port = hit?.kind === "node" && hit.hit.kind === "port" ? hit.hit.port : null;
        interaction.target =
          port && hit?.kind === "node" && this.portHighlight(port, hit.view.viewId) === "compatible" && port.id !== interaction.from.id
            ? { port, view: hit.view }
            : null;
        this.requestFrame();
        return;
      }
      case "box":
        if (event.pointerId === interaction.pointerId) {
          interaction.current = point;
          this.overlayDirty = true;
          this.updateBoxSelection(interaction);
        }
        return;
      case "resize":
        if (event.pointerId === interaction.pointerId) {
          this.editor.updateNote(interaction.view.id, {
            size: {
              width: Math.round(interaction.origin.width + world.x - interaction.start.x),
              height: Math.round(interaction.origin.height + world.y - interaction.start.y),
            },
          });
        }
        return;
      case "press":
        return;
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const interaction = this.interaction;
    if (interaction.kind === "none" || event.pointerId !== interaction.pointerId) {
      return;
    }
    this.interaction = { kind: "none" };
    const canvas = this.app.canvas;
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = "";

    switch (interaction.kind) {
      case "pan":
        if (interaction.button === 2 && !interaction.moved) {
          this.openContextMenu(event);
        }
        break;
      case "connect":
        if (interaction.target) {
          const { port, view } = interaction.target;
          this.editor.connectPorts(interaction.from.id, port.id, interaction.fromView.viewId, view.viewId);
        } else {
          const hit = this.hitTest(this.screenToWorld(this.localPoint(event)), false);
          if (hit?.kind === "node" && hit.hit.kind === "port" && hit.hit.port.id !== interaction.from.id) {
            // Let the editor report why the connection is not allowed.
            this.editor.connectPorts(interaction.from.id, hit.hit.port.id, interaction.fromView.viewId, hit.view.viewId);
          } else {
            this.editor.setStatus("Connection cancelled.");
          }
        }
        this.invalidateAllNodes();
        break;
      case "box":
        this.overlayDirty = true;
        break;
      case "drag":
        this.translatingEdges = new Set();
        this.editor.endInteraction();
        break;
      case "resize":
        this.editor.endInteraction();
        break;
      case "press": {
        const hit = this.hitTest(this.screenToWorld(this.localPoint(event)), false);
        const { view, control, segment } = interaction;
        const released = hit?.kind === "node" && hit.view === view && hit.hit.kind === "control" ? hit.hit : null;
        if (released && released.control.key === control.key && released.segment === segment) {
          this.applyControl(view, control, segment);
        }
        break;
      }
    }
    this.updateHover(this.screenToWorld(this.localPoint(event)));
    this.requestFrame();
  };

  /** Selects what was right-clicked (keeping a selection it is part of) and asks for a menu. */
  private openContextMenu(event: PointerEvent): void {
    if (!this.contextMenuListener) return;
    const world = this.screenToWorld(this.localPoint(event));
    const hit = this.hitTest(world);
    let target: ContextTarget;
    if (hit?.kind === "node") {
      const viewId = hit.view.viewId;
      if (!this.selection.has(viewId)) {
        this.setEdgeSelection(new Set());
        this.setSelection(new Set([viewId]));
      }
      target = { kind: "node", viewId };
    } else if (hit?.kind === "note") {
      const noteId = hit.view.id;
      if (!this.selection.has(noteId)) {
        this.setEdgeSelection(new Set());
        this.setSelection(new Set([noteId]));
      }
      target = { kind: "note", noteId };
    } else if (hit?.kind === "edge") {
      const id = hit.view.connection.id;
      if (!this.selectedEdges.has(id)) {
        this.setSelection(new Set());
        this.setEdgeSelection(new Set([id]));
      }
      target = { kind: "edge", connectionId: id };
    } else {
      target = { kind: "canvas" };
    }
    this.requestFrame();
    this.contextMenuListener({ clientX: event.clientX, clientY: event.clientY, world, target });
  }

  /** Double-click on a node header renames the node. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const hit = this.hitTest(this.screenToWorld(this.localPoint(event)), false);
    if (hit?.kind === "node" && hit.hit.kind === "header" && hit.view.node.schema?.naming.editable) {
      this.openRenameEditor(hit.view);
    } else if (hit?.kind === "note") {
      this.openNoteEditor(hit.view);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.tooltip.hide();
    if (this.interaction.kind === "none" && (this.hovered || this.hoveredNote)) {
      this.setHovered(null, null, null);
      this.setHoveredNote(null);
      this.app.canvas.style.cursor = "";
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const point = this.localPoint(event);
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
    this.zoomAround(point, this.viewport.zoom * Math.exp(-delta * 0.0015));
  };

  private updateHover(world: Vec2): void {
    const hit = this.hitTest(world, false);
    const canvas = this.app.canvas;
    this.setHoveredNote(hit?.kind === "note" ? hit.view : null);
    if (hit?.kind !== "node") {
      if (this.hovered) {
        this.setHovered(null, null, null);
      }
      this.tooltip.hide();
      canvas.style.cursor = this.spaceDown ? "grab" : hit?.kind === "note" ? (hit.hit === "resize" ? "nwse-resize" : "move") : "";
      return;
    }
    const info = hit.hit.kind === "info";
    const portId = hit.hit.kind === "port" ? hit.hit.port.id : null;
    const control = hit.hit.kind === "control" ? hit.hit.control.key : info ? INFO_KEY : null;
    const segment = hit.hit.kind === "control" ? hit.hit.segment : null;
    this.setHovered(hit.view, portId, control, segment);
    const schema = hit.view.node.schema;
    if (info && schema?.description && hit.view.infoRect) {
      this.tooltip.show(hit.view.viewId, this.screenRect(hit.view, hit.view.infoRect), schema.title, schema.description);
    } else {
      this.tooltip.hide();
    }
    canvas.style.cursor = portId ? "crosshair" : info ? "help" : control !== null ? "pointer" : "move";
  }

  private setHoveredNote(view: NoteView | null): void {
    if (this.hoveredNote === view) return;
    if (this.hoveredNote) {
      this.hoveredNote.hovered = false;
      this.hoveredNote.redraw();
    }
    this.hoveredNote = view;
    if (view) {
      view.hovered = true;
      view.redraw();
    }
    this.requestFrame();
  }

  private updateBoxSelection(box: Extract<Interaction, { kind: "box" }>): void {
    if (Math.abs(box.current.x - box.start.x) < BOX_SELECT_THRESHOLD && Math.abs(box.current.y - box.start.y) < BOX_SELECT_THRESHOLD) {
      return;
    }
    const a = this.screenToWorld(box.start);
    const b = this.screenToWorld(box.current);
    const area: Bounds = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const apply = (next: Set<string>, initial: Set<string>, id: string) => {
      if (box.mode === "toggle" && initial.has(id)) next.delete(id);
      else next.add(id);
    };
    const next = box.mode === "replace" ? new Set<string>() : new Set(box.initial);
    let touchedNodes = false;
    for (const view of this.nodeViews.values()) {
      const { x, y, width, height } = view.rect;
      if (rectsIntersect({ minX: x, minY: y, maxX: x + width, maxY: y + height }, area)) {
        touchedNodes = true;
        apply(next, box.initial, view.viewId);
      }
    }
    for (const view of this.noteViews.values()) {
      const { x, y, width, height } = view.rect;
      if (rectsIntersect({ minX: x, minY: y, maxX: x + width, maxY: y + height }, area)) {
        touchedNodes = true;
        apply(next, box.initial, view.id);
      }
    }
    // Connections are picked only by a box over empty space: a box over nodes would otherwise also
    // grab unrelated wires passing by.
    const nextEdges = box.mode === "replace" ? new Set<string>() : new Set(box.initialEdges);
    if (!touchedNodes) {
      for (const [id, view] of this.edgeViews) {
        if (view.path && rectsIntersect(view.bounds, area) && edgeIntersectsBounds(view.path, area)) {
          apply(nextEdges, box.initialEdges, id);
        }
      }
    }
    this.setSelection(next);
    this.setEdgeSelection(nextEdges);
  }

  // --- Keyboard ------------------------------------------------------------------------

  /** Only Space (hold to pan) lives here; all other shortcuts are dispatched by the app keymap. */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (physicalKey(event) === "Space" && !this.spaceDown && !isEditableTarget(event.target)) {
      this.spaceDown = true;
      if (this.interaction.kind === "none") {
        this.app.canvas.style.cursor = "grab";
      }
      event.preventDefault();
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (physicalKey(event) === "Space") {
      this.spaceDown = false;
      if (this.interaction.kind === "none") {
        this.app.canvas.style.cursor = "";
      }
    }
  };

  private readonly onWindowBlur = (): void => {
    this.spaceDown = false;
  };

  // --- Inline editing ----------------------------------------------------------------------

  private portColor(typeId: string): number {
    return this.graph?.registry.portTypes.get(typeId)?.color ?? typeColor(typeId);
  }

  /** Screen rectangle (canvas pixels) of a node-local rectangle. */
  private screenRect(view: NodeView, rect: { x: number; y: number; width: number; height: number }) {
    const { x, y, zoom } = this.viewport;
    return {
      x: x + (view.position.x + rect.x) * zoom,
      y: y + (view.position.y + rect.y) * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    };
  }

  /** Applies a click on a checkbox, enum segment, list button or matrix cell. */
  private applyControl(view: NodeView, control: Control, segment: number | null): void {
    const nodeId = view.node.id;
    if (control.type === "button") {
      const { action } = control;
      if (action.type === "add") this.editor.addListItem(nodeId, action.path);
      else if (action.type === "remove") this.editor.removeListItem(nodeId, action.path, action.index);
      else this.editor.moveListItem(nodeId, action.path, action.index, action.delta);
    } else if (control.type === "cell") {
      this.editor.toggleMatrixCell(nodeId, control.fieldId, control.row, control.column);
    } else if (control.kind === "bool") {
      this.editor.setValue(nodeId, control.path, getIn(view.node.data, control.path) !== true);
    } else if (control.kind === "segmented" && segment !== null && control.field.type === "enum") {
      this.editor.setValue(nodeId, control.path, control.field.options[segment].value);
    }
  }

  /** Rebuilds nodes showing `key` (every node with texts when null, e.g. after a language switch). */
  private refreshTexts(key: string | null): void {
    for (const view of this.nodeViews.values()) {
      if (key === null ? view.localizedKeys.size === 0 && !view.hasUnnamedTexts : !view.localizedKeys.has(key)) continue;
      if (view.container.visible) {
        view.rebuild();
        // Text boxes grow with their text, so the node may have a new size.
        this.markNodeEdgesDirty(view.node.id);
      } else {
        view.staleLayout = true;
      }
    }
    this.requestFrame();
  }

  /** Nodes showing item references re-read labels after the referenced node changes. */
  private refreshReferences(changedNodeId: string): void {
    for (const view of this.nodeViews.values()) {
      if (!view.hasReferences || view.node.id === changedNodeId) continue;
      if (view.container.visible) {
        view.rebuild();
      } else {
        view.staleLayout = true;
      }
    }
  }

  private openFieldEditor(view: NodeView, control: Control & { type: "field" }): void {
    const { field, path } = control;
    const nodeId = view.node.id;
    const value = getIn(view.node.data, path);
    const rect = this.screenRect(view, control.hitRect);
    const fontSize = 12 * this.viewport.zoom;
    this.editedNode = view;

    if (field.type === "enum") {
      this.inlineEditor.pick({
        rect,
        fontSize: Math.max(11, fontSize),
        options: field.options,
        current: typeof value === "string" ? value : null,
        onPick: (picked) => this.editor.setValue(nodeId, path, picked),
      });
    } else if (field.type === "itemRef" || field.type === "nodeRef") {
      const options = field.type === "itemRef" ? itemRefCandidates(this.graph, field) : nodeRefCandidates(this.graph, field);
      this.inlineEditor.pick({
        rect,
        fontSize: Math.max(11, fontSize),
        options: [{ value: "", label: "None" }, ...options],
        current: typeof value === "string" ? value : "",
        searchable: true,
        emptyText: field.type === "itemRef" ? "No matching elements." : "No matching nodes.",
        onPick: (picked) => this.editor.setValue(nodeId, path, picked || null),
      });
    } else if (field.type === "localizedText") {
      const key = localizationKey(view.node, field, path, value);
      if (!key) {
        this.editor.setStatus("Name the node first: its name is the localization key.", "error");
        this.openRenameEditor(view);
        return;
      }
      // Edited in place, in the language chosen in the toolbar.
      const language = this.editor.getSnapshot().displayLanguage;
      if (!language) {
        this.editor.setStatus("The schema pack has no languages.", "error");
        return;
      }
      const current = this.editor.localization.get(language, key) ?? "";
      this.inlineEditor.editText({
        rect,
        fontSize,
        value: current,
        multiline: field.multiline,
        language,
        placeholder: `${language.toUpperCase()} text`,
        onCommit: (text) => {
          if (text !== current) this.editor.setTexts(key, { [language]: text });
        },
      });
    } else if (field.type === "resource") {
      const library = this.graph.registry.pack?.resources;
      const items = library ? resourcesOfType(library, field.resourceType) : [];
      this.inlineEditor.pick({
        rect,
        fontSize: Math.max(11, fontSize),
        options: [{ value: "", label: "None" }, ...items.map((item) => ({ value: item.id, label: item.name }))],
        current: typeof value === "string" ? value : "",
        searchable: items.length > 8,
        emptyText: `No ${library?.types.get(field.resourceType)?.label ?? "resources"} found.`,
        onPick: (picked) => this.editor.setValue(nodeId, path, picked || null),
      });
    } else if (field.type === "resourceVariant") {
      const source = view.node.data[field.source];
      const item = typeof source === "string" ? this.graph.registry.pack?.resources.items.get(source) : undefined;
      const variants = item?.variants.get(field.collection) ?? [];
      this.inlineEditor.pick({
        rect,
        fontSize: Math.max(11, fontSize),
        options: variants.map((variant) => ({ value: variant.id, label: variant.label })),
        current: typeof value === "string" ? value : null,
        searchable: variants.length > 8,
        emptyText: "This resource has no variants.",
        onPick: (picked) => this.editor.setValue(nodeId, path, picked),
      });
    } else if (field.type === "int" || field.type === "float") {
      this.inlineEditor.editText({
        rect,
        fontSize,
        value: formatNumber(value),
        align: "right",
        inputMode: field.type === "int" ? "numeric" : "decimal",
        onCommit: (text) => {
          const parsed = Number(text.trim().replace(",", "."));
          if (text.trim() === "" || !Number.isFinite(parsed)) {
            this.editor.setStatus(`'${text}' is not a number.`, "error");
            return;
          }
          const number = clampNumber(field, field.type === "int" ? Math.round(parsed) : parsed);
          this.editor.setValue(nodeId, path, number);
        },
      });
    } else if (field.type === "string") {
      this.inlineEditor.editText({
        rect,
        fontSize,
        value: typeof value === "string" ? value : "",
        multiline: field.multiline,
        placeholder: field.placeholder,
        onCommit: (text) => this.editor.setValue(nodeId, path, text),
      });
    }
  }

  /** Edits a note's text in place, in a text area laid over the sheet with the same font and lines. */
  private openNoteEditor(view: NoteView): void {
    const noteId = view.id;
    const { x, y, zoom } = this.viewport;
    const area = view.textRect;
    view.editing = true;
    view.redraw();
    this.requestFrame();
    this.inlineEditor.editText({
      rect: {
        x: x + (view.note.position.x + area.x) * zoom,
        y: y + (view.note.position.y + area.y) * zoom,
        width: area.width * zoom,
        height: area.height * zoom,
      },
      fontSize: NOTE_TEXT_SIZE * zoom,
      lineHeight: NOTE_LINE_HEIGHT * zoom,
      multiline: true,
      variant: "note",
      value: view.note.text,
      placeholder: "Write a note…",
      onCommit: (text) => this.editor.updateNote(noteId, { text }),
      onClose: () => {
        view.editing = false;
        if (this.noteViews.get(noteId) === view) view.redraw();
        this.requestFrame();
      },
    });
  }

  private openRenameEditor(view: NodeView): void {
    const nodeId = view.node.id;
    this.editedNode = view;
    this.inlineEditor.editText({
      rect: this.screenRect(view, { x: 4, y: 4, width: view.width - 8, height: view.headerHeight - 8 }),
      fontSize: 13 * this.viewport.zoom,
      value: view.node.name,
      placeholder: view.node.schema?.title,
      onCommit: (text) => {
        this.editor.renameNode(nodeId, text);
      },
    });
  }
}

function preventDefault(event: Event): void {
  event.preventDefault();
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
