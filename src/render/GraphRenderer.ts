import { Application, Container, Graphics } from "pixi.js";
import type { Editor, GraphReplacedOptions } from "../app/editor";
import type { GraphChange, GraphModel } from "../graph/graph";
import { clampZoom, type Connection, type Port, type Vec2, type Viewport } from "../graph/types";
import { DotGrid } from "./DotGrid";
import { EdgeView, traceEdgePath } from "./EdgeView";
import { type Bounds, computeEdgePath, hitTestEdge, rectsIntersect } from "./geometry";
import { clampNumber } from "../graph/schema";
import { localizationKey } from "../graph/localization";
import { physicalKey } from "../app/keys";
import { resourcesOfType } from "../graph/resources";
import { ImageCache } from "./ImageCache";
import { InlineEditor } from "./InlineEditor";
import { getIn, itemRefCandidates, itemRefLabel, nodeRefCandidates } from "../graph/dataOps";
import { type Control, formatNumber, type NodeHit, NodeView, type PortHighlight } from "./NodeView";
import { installFonts } from "./text";
import { theme, typeColor } from "./theme";

/** Below this zoom texts are hidden: they are unreadable anyway and dominate the draw cost. */
const DETAIL_ZOOM = 0.4;
/** Edges keep at least this on-screen width (px) when zoomed out. */
const MIN_EDGE_SCREEN_WIDTH = 1.3;
const EDGE_BASE_WIDTH = 2.25;
const BOX_SELECT_THRESHOLD = 4;
/** Max CPU time per frame spent re-stroking edges after a zoom step; the rest continues next frame. */
const EDGE_RESTYLE_BUDGET_MS = 6;

type Hit =
  | { kind: "node"; view: NodeView; hit: NodeHit }
  | { kind: "edge"; view: EdgeView };

type Interaction =
  | { kind: "none" }
  | { kind: "pan"; pointerId: number; start: Vec2; startViewport: Viewport }
  | {
      kind: "drag";
      pointerId: number;
      start: Vec2;
      origins: Map<string, Vec2>;
      /** Edges with both ends inside the dragged group: translated instead of rebuilt. */
      internalEdges: Set<string>;
      applied: Vec2;
    }
  | { kind: "connect"; pointerId: number; from: Port; cursor: Vec2; target: Port | null }
  | { kind: "box"; pointerId: number; start: Vec2; current: Vec2; mode: "replace" | "add" | "toggle"; initial: Set<string> }
  /** Pressing a checkbox or an enum segment; applied on release over the same target. */
  | { kind: "press"; pointerId: number; view: NodeView; control: Control; segment: number | null };

export interface RendererStats {
  frameMs: number;
  visibleNodes: number;
  visibleEdges: number;
}

export class GraphRenderer {
  private readonly app = new Application();
  private readonly grid = new DotGrid();
  private readonly world = new Container();
  private readonly edgeLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly preview = new Graphics();
  private readonly overlay = new Graphics();

  private graph!: GraphModel;
  private unsubscribeGraph: () => void = () => {};
  private unsubscribeEditor: () => void = () => {};
  private unsubscribeLocalization: () => void = () => {};
  private readonly nodeViews = new Map<string, NodeView>();
  private readonly viewsByContainer = new Map<Container, NodeView>();
  private readonly edgeViews = new Map<string, EdgeView>();
  private readonly selection = new Set<string>();
  private selectedEdge: EdgeView | null = null;
  private hovered: NodeView | null = null;
  private interaction: Interaction = { kind: "none" };
  private highlightCache = new Map<string, PortHighlight>();

  private viewport: Viewport = { x: 0, y: 0, zoom: 1 };
  private screen = { width: 1, height: 1 };
  private detailVisible = true;
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
  private readonly images = new ImageCache<NodeView>(
    (path) => this.editor.readResource(path),
    (views) => {
      for (const view of views) {
        if (!this.nodeViews.has(view.node.id)) continue;
        if (view.container.visible) view.rebuild();
        else view.staleLayout = true;
      }
      this.requestFrame();
    },
  );
  /** Node being edited inline, so the editor closes if the node disappears. */
  private editedNode: NodeView | null = null;
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
    this.world.addChild(this.edgeLayer, this.nodeLayer, this.preview);

    const canvas = this.app.canvas;
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    this.host.appendChild(canvas);
    this.inlineEditor = new InlineEditor(this.host);
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
    this.frameNodes(this.nodeViews.keys());
  }

  /** Frames the selection, or the whole graph when nothing is selected. */
  frameSelection(): void {
    this.frameNodes(this.selection.size > 0 ? this.selection : this.nodeViews.keys());
  }

  private frameNodes(nodeIds: Iterable<string>): void {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const id of nodeIds) {
      const view = this.nodeViews.get(id);
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

  /** True while a mouse gesture (drag, connect, pan, box select) is in progress. */
  isInteracting(): boolean {
    return this.interaction.kind !== "none";
  }

  /** Graph position of the pointer when it is over the canvas. */
  pointerPosition(): Vec2 | null {
    return this.pointerInside ? this.screenToWorld(this.pointer) : null;
  }

  selectedNodeIds(): string[] {
    return [...this.selection];
  }

  selectNodes(nodeIds: Iterable<string>): void {
    this.selectEdge(null);
    const ids = new Set([...nodeIds].filter((id) => this.nodeViews.has(id)));
    this.setSelection(ids);
    this.bringToFront(ids);
  }

  selectAll(): void {
    this.selectNodes(this.nodeViews.keys());
  }

  clearSelection(): void {
    this.setSelection(new Set());
    this.selectEdge(null);
  }

  nudgeSelection(dx: number, dy: number): void {
    for (const id of this.selection) {
      const node = this.graph.getNode(id);
      if (node) {
        this.graph.moveNode(id, { x: node.position.x + dx, y: node.position.y + dy });
      }
    }
  }

  deleteSelection(): void {
    const nodeIds = [...this.selection];
    const connectionIds = this.selectedEdge ? [this.selectedEdge.connection.id] : [];
    if (nodeIds.length === 0 && connectionIds.length === 0) {
      return;
    }
    this.setSelection(new Set());
    this.selectEdge(null);
    this.editor.deleteElements(nodeIds, connectionIds);
  }

  // --- Graph binding -----------------------------------------------------------

  private setGraph(graph: GraphModel, options: GraphReplacedOptions): void {
    this.inlineEditor.close(false);
    if (graph.registry !== this.graph?.registry) {
      // A new pack may have different files behind the same paths.
      this.images.clear();
    }
    this.unsubscribeGraph();
    this.graph = graph;
    this.unsubscribeGraph = graph.subscribe(this.onGraphChange);
    if (this.interaction.kind === "drag") {
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
    for (const view of this.nodeViews.values()) {
      view.destroy();
    }
    for (const view of this.edgeViews.values()) {
      view.destroy();
    }
    this.nodeViews.clear();
    this.viewsByContainer.clear();
    this.edgeViews.clear();
    this.dirtyEdges.clear();
    this.restyleEdges.clear();
    this.translatingEdges = new Set();
    this.selection.clear();
    this.selectedEdge = null;
    this.hovered = null;
    for (const node of this.graph.nodes) {
      this.addNodeView(node.id);
    }
    for (const connection of this.graph.connections) {
      this.addEdgeView(connection);
    }
    this.allEdgesDirty = true;
    this.editor.setSelectionCount(0);
    this.requestFrame();
  }

  private readonly onGraphChange = (change: GraphChange): void => {
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
      case "nodeDataChanged":
      case "nodeRenamed":
        this.nodeViews.get(change.node.id)?.rebuild();
        this.markNodeEdgesDirty(change.node.id);
        this.refreshReferences(change.node.id);
        break;
      case "nodePortsChanged":
        this.nodeViews.get(change.node.id)?.rebuild();
        this.markNodeEdgesDirty(change.node.id);
        break;
      case "connectionAdded":
        this.addEdgeView(change.connection);
        this.redrawNodes(change.connection);
        break;
      case "connectionRemoved": {
        const view = this.edgeViews.get(change.connection.id);
        if (view) {
          if (this.selectedEdge === view) {
            this.selectedEdge = null;
          }
          view.destroy();
          this.edgeViews.delete(change.connection.id);
          this.dirtyEdges.delete(change.connection.id);
          this.restyleEdges.delete(change.connection.id);
        }
        this.redrawNodes(change.connection);
        break;
      }
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

  private addNodeView(nodeId: string): void {
    const node = this.graph.getNode(nodeId);
    if (!node || this.nodeViews.has(nodeId)) {
      return;
    }
    const view = new NodeView(node, {
      isPortConnected: (portId) => this.graph.hasConnections(portId),
      portHighlight: (port) => this.portHighlight(port),
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
    });
    view.setDetailVisible(this.detailVisible);
    this.nodeViews.set(nodeId, view);
    this.viewsByContainer.set(view.container, view);
    this.nodeLayer.addChild(view.container);
  }

  private removeNodeView(nodeId: string): void {
    const view = this.nodeViews.get(nodeId);
    if (!view) {
      return;
    }
    if (this.hovered === view) {
      this.hovered = null;
    }
    if (this.editedNode === view) {
      this.inlineEditor.close(false);
    }
    if (this.selection.delete(nodeId)) {
      this.editor.setSelectionCount(this.selection.size);
    }
    this.viewsByContainer.delete(view.container);
    this.nodeViews.delete(nodeId);
    view.destroy();
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

  private redrawNodes(connection: Connection): void {
    this.nodeViews.get(connection.outputNodeId)?.redraw();
    this.nodeViews.get(connection.inputNodeId)?.redraw();
  }

  private refreshEdge(view: EdgeView): void {
    const { connection } = view;
    const source = this.nodeViews.get(connection.outputNodeId);
    const target = this.nodeViews.get(connection.inputNodeId);
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
        if (nodeView.staleLayout) {
          nodeView.stale = false;
          nodeView.rebuild();
        } else if (nodeView.stale) {
          nodeView.stale = false;
          nodeView.redraw();
        }
      }
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
    const { from, cursor, target } = this.interaction;
    const fromPosition = this.nodeViews.get(from.nodeId)?.portWorldPosition(from.id);
    if (!fromPosition) {
      return;
    }
    const other = (target && this.nodeViews.get(target.nodeId)?.portWorldPosition(target.id)) || cursor;
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

    const detailVisible = zoom >= DETAIL_ZOOM;
    if (detailVisible !== this.detailVisible) {
      this.detailVisible = detailVisible;
      this.nodeViews.forEach((view) => view.setDetailVisible(detailVisible));
    }

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
    this.editor.setSelectionCount(this.selection.size);
    this.requestFrame();
  }

  private setNodeSelected(nodeId: string, selected: boolean): void {
    const view = this.nodeViews.get(nodeId);
    if (view && view.selected !== selected) {
      view.selected = selected;
      view.redraw();
    }
  }

  private selectEdge(view: EdgeView | null): void {
    if (this.selectedEdge === view) {
      return;
    }
    if (this.selectedEdge) {
      this.selectedEdge.selected = false;
      this.selectedEdge.redraw(this.edgeScale);
    }
    this.selectedEdge = view;
    if (view) {
      view.selected = true;
      view.redraw(this.edgeScale);
      this.edgeLayer.addChild(view.graphics);
    }
    this.requestFrame();
  }

  private bringToFront(nodeIds: Iterable<string>): void {
    for (const id of nodeIds) {
      const view = this.nodeViews.get(id);
      if (view) {
        this.nodeLayer.addChild(view.container);
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
    if (!includeEdges) {
      return null;
    }
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
    return null;
  }

  private portHighlight(port: Port): PortHighlight {
    if (this.interaction.kind !== "connect") {
      return "normal";
    }
    let highlight = this.highlightCache.get(port.id);
    if (highlight === undefined) {
      const from = this.interaction.from;
      if (port.id === from.id) {
        highlight = "compatible";
      } else if (port.direction === from.direction) {
        highlight = "incompatible";
      } else {
        const [output, input] = from.direction === "Output" ? [from, port] : [port, from];
        highlight = this.graph.canConnect(output.id, input.id) === null ? "compatible" : "incompatible";
      }
      this.highlightCache.set(port.id, highlight);
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
    // Suppress the compatibility mousedown, which would move focus away from an inline editor we open below.
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }

    if (event.button === 1 || event.button === 2 || (event.button === 0 && this.spaceDown)) {
      event.preventDefault();
      this.interaction = { kind: "pan", pointerId: event.pointerId, start: point, startViewport: { ...this.viewport } };
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const hit = this.hitTest(world);
    const additive = event.shiftKey;
    const toggle = event.ctrlKey || event.metaKey;

    if (hit?.kind === "node" && hit.hit.kind === "port") {
      this.selectEdge(null);
      this.interaction = { kind: "connect", pointerId: event.pointerId, from: hit.hit.port, cursor: world, target: null };
      this.invalidateAllNodes();
      this.editor.setStatus(`Connecting from ${hit.hit.port.displayName}...`);
    } else if (hit?.kind === "node") {
      const nodeId = hit.view.node.id;
      this.selectEdge(null);
      if (toggle) {
        const next = new Set(this.selection);
        if (!next.delete(nodeId)) {
          next.add(nodeId);
        }
        this.setSelection(next);
      } else if (additive) {
        this.setSelection(new Set([...this.selection, nodeId]));
      } else if (!this.selection.has(nodeId)) {
        this.setSelection(new Set([nodeId]));
      }

      if (hit.hit.kind === "control") {
        const { control, segment } = hit.hit;
        if (control.type === "field" && control.kind !== "bool" && control.kind !== "segmented") {
          this.openFieldEditor(hit.view, control);
          return;
        }
        // Checkboxes, segments, list buttons and matrix cells act on release over the same target.
        this.interaction = { kind: "press", pointerId: event.pointerId, view: hit.view, control, segment };
      } else if (this.selection.has(nodeId)) {
        this.bringToFront(this.selection);
        const origins = new Map<string, Vec2>();
        const internalEdges = new Set<string>();
        for (const id of this.selection) {
          const node = this.graph.getNode(id);
          if (node) {
            origins.set(id, { ...node.position });
            for (const connection of this.graph.getNodeConnections(id)) {
              if (this.selection.has(connection.outputNodeId) && this.selection.has(connection.inputNodeId)) {
                internalEdges.add(connection.id);
              }
            }
          }
        }
        this.translatingEdges = internalEdges;
        this.editor.beginInteraction();
        this.interaction = {
          kind: "drag",
          pointerId: event.pointerId,
          start: world,
          origins,
          internalEdges,
          applied: { x: 0, y: 0 },
        };
      }
    } else if (hit?.kind === "edge") {
      this.setSelection(new Set());
      this.selectEdge(hit.view);
      this.editor.setStatus("Connection selected.");
    } else {
      this.selectEdge(null);
      const mode = toggle ? "toggle" : additive ? "add" : "replace";
      if (mode === "replace") {
        this.setSelection(new Set());
      }
      this.interaction = {
        kind: "box",
        pointerId: event.pointerId,
        start: point,
        current: point,
        mode,
        initial: new Set(this.selection),
      };
    }

    if (this.interaction.kind !== "none") {
      canvas.setPointerCapture(event.pointerId);
    }
    this.requestFrame();
  };

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
          this.graph.moveNode(id, { x: origin.x + dx, y: origin.y + dy });
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
        interaction.target = port && this.portHighlight(port) === "compatible" && port.id !== interaction.from.id ? port : null;
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
      case "connect":
        if (interaction.target) {
          this.editor.connectPorts(interaction.from.id, interaction.target.id);
        } else {
          const hit = this.hitTest(this.screenToWorld(this.localPoint(event)), false);
          if (hit?.kind === "node" && hit.hit.kind === "port" && hit.hit.port.id !== interaction.from.id) {
            // Let the editor report why the connection is not allowed.
            this.editor.connectPorts(interaction.from.id, hit.hit.port.id);
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

  /** Double-click on a node header renames the node. */
  private readonly onDoubleClick = (event: MouseEvent): void => {
    const hit = this.hitTest(this.screenToWorld(this.localPoint(event)), false);
    if (hit?.kind === "node" && hit.hit.kind === "header" && hit.view.node.schema?.naming.editable) {
      this.openRenameEditor(hit.view);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    if (this.interaction.kind === "none" && this.hovered) {
      this.setHovered(null, null, null);
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
    if (hit?.kind !== "node") {
      if (this.hovered) {
        this.setHovered(null, null, null);
      }
      canvas.style.cursor = this.spaceDown ? "grab" : "";
      return;
    }
    const portId = hit.hit.kind === "port" ? hit.hit.port.id : null;
    const control = hit.hit.kind === "control" ? hit.hit.control.key : null;
    const segment = hit.hit.kind === "control" ? hit.hit.segment : null;
    this.setHovered(hit.view, portId, control, segment);
    canvas.style.cursor = portId ? "crosshair" : control !== null ? "pointer" : "move";
  }

  private updateBoxSelection(box: Extract<Interaction, { kind: "box" }>): void {
    if (Math.abs(box.current.x - box.start.x) < BOX_SELECT_THRESHOLD && Math.abs(box.current.y - box.start.y) < BOX_SELECT_THRESHOLD) {
      return;
    }
    const a = this.screenToWorld(box.start);
    const b = this.screenToWorld(box.current);
    const area: Bounds = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
    const next = box.mode === "replace" ? new Set<string>() : new Set(box.initial);
    for (const view of this.nodeViews.values()) {
      const { x, y, width, height } = view.rect;
      if (!rectsIntersect({ minX: x, minY: y, maxX: x + width, maxY: y + height }, area)) {
        continue;
      }
      const id = view.node.id;
      if (box.mode === "toggle" && box.initial.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
    }
    this.setSelection(next);
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
      x: x + (view.node.position.x + rect.x) * zoom,
      y: y + (view.node.position.y + rect.y) * zoom,
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
      if (view.container.visible) view.rebuild();
      else view.staleLayout = true;
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
        this.editor.setStatus("Name the node first: its name is the localization key.");
        this.openRenameEditor(view);
        return;
      }
      const store = this.editor.localization;
      const { languages, displayLanguage } = this.editor.getSnapshot();
      this.inlineEditor.editTexts({
        rect: { ...rect, height: 0 },
        key,
        languages,
        values: Object.fromEntries(languages.map((language) => [language, store.get(language, key) ?? ""])),
        focusLanguage: displayLanguage,
        onCommit: (values) => {
          const changed = Object.fromEntries(Object.entries(values).filter(([language, text]) => (store.get(language, key) ?? "") !== text));
          if (Object.keys(changed).length > 0) this.editor.setTexts(key, changed);
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
            this.editor.setStatus(`'${text}' is not a number.`);
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
