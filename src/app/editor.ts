import { type ClipboardData, copyNodes, pasteNodes } from "../graph/clipboard";
import { GraphModel, type GraphChange } from "../graph/graph";
import { GraphHistory } from "../graph/history";
import type { NodeGraphRegistry } from "../graph/registry";
import { createSampleRegistry, type NumberState } from "../graph/samples";
import { GraphJsonSerializer } from "../graph/serializer";
import type { Vec2 } from "../graph/types";
import { createFileSystem, type GraphFileSystem } from "./files";

export interface EditorSnapshot {
  status: string;
  /** Incremented on every status message, so repeated identical messages are still noticed. */
  statusId: number;
  dirty: boolean;
  fileName: string | null;
  /** Full path of the document on disk; null until saved (always null in a plain browser). */
  filePath: string | null;
  nodeCount: number;
  connectionCount: number;
  selectionCount: number;
  warnings: readonly string[];
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
}

/** Approximate node size, used to center pasted nodes on the cursor. */
const NODE_SIZE_ESTIMATE = { width: 220, height: 110 };
const PASTE_STEP = 32;

export interface GraphReplacedOptions {
  /** Fit the whole graph into view instead of restoring the saved viewport. */
  frameAll: boolean;
}

type GraphReplacedListener = (graph: GraphModel, options: GraphReplacedOptions) => void;

export class Editor {
  readonly registry: NodeGraphRegistry;
  private readonly serializer: GraphJsonSerializer;
  private readonly files: GraphFileSystem;
  private currentGraph: GraphModel;
  private unsubscribeGraph: () => void = () => {};
  private readonly listeners = new Set<() => void>();
  private readonly graphReplacedListeners = new Set<GraphReplacedListener>();
  private filePath: string | null = null;
  private state: EditorSnapshot;
  private notifyScheduled = false;
  private readonly history = new GraphHistory(() =>
    this.update({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }),
  );
  private clipboard: ClipboardData | null = null;
  private pasteCount = 0;

  constructor(options: { registry?: NodeGraphRegistry; files?: GraphFileSystem } = {}) {
    this.registry = options.registry ?? createSampleRegistry();
    this.serializer = new GraphJsonSerializer(this.registry);
    this.files = options.files ?? createFileSystem();
    this.currentGraph = new GraphModel(this.registry);
    this.state = {
      status: "",
      statusId: 0,
      dirty: false,
      fileName: null,
      filePath: null,
      nodeCount: 0,
      connectionCount: 0,
      selectionCount: 0,
      warnings: [],
      canUndo: false,
      canRedo: false,
      canPaste: false,
    };
    this.attach(this.currentGraph);
  }

  get graph(): GraphModel {
    return this.currentGraph;
  }

  // --- React store protocol -------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.state;

  onGraphReplaced(listener: GraphReplacedListener): () => void {
    this.graphReplacedListeners.add(listener);
    return () => this.graphReplacedListeners.delete(listener);
  }

  // --- Document commands -----------------------------------------------------

  async newGraph(): Promise<void> {
    if (!(await this.confirmDiscard())) {
      return;
    }
    this.replaceGraph(new GraphModel(this.registry), null, "New graph.", [], false);
  }

  async open(): Promise<void> {
    try {
      if (!(await this.confirmDiscard())) {
        return;
      }
      const file = await this.files.open();
      if (!file) {
        return;
      }
      const { graph, warnings } = this.serializer.deserialize(file.text);
      const status = warnings.length === 0 ? `Opened: ${file.name}` : `Opened ${file.name} with ${warnings.length} warning(s).`;
      this.replaceGraph(graph, file.path, status, warnings, false);
      this.update({ fileName: file.name });
    } catch (error) {
      this.setStatus(`Open failed: ${errorMessage(error)}`);
    }
  }

  async save(chooseLocation = false): Promise<void> {
    try {
      const saved = await this.files.save(this.serializer.serialize(this.graph), this.filePath, chooseLocation);
      if (!saved) {
        return;
      }
      this.filePath = saved.path;
      this.update({ dirty: false, fileName: saved.name, filePath: saved.path, status: `Saved: ${saved.name}` });
    } catch (error) {
      this.setStatus(`Save failed: ${errorMessage(error)}`);
    }
  }

  // --- Graph commands --------------------------------------------------------

  addNode(typeId: string, position: Vec2): void {
    try {
      this.graph.addNode(typeId, position);
    } catch (error) {
      this.setStatus(`Could not add node: ${errorMessage(error)}`);
    }
  }

  deleteElements(nodeIds: Iterable<string>, connectionIds: Iterable<string>): void {
    let removed = 0;
    for (const id of connectionIds) {
      removed += this.graph.disconnect(id) ? 1 : 0;
    }
    for (const id of nodeIds) {
      removed += this.graph.removeNode(id) ? 1 : 0;
    }
    if (removed > 0) {
      this.setStatus(`Deleted ${removed} element(s).`);
    }
  }

  /** Connects two ports given in any order. */
  connectPorts(firstPortId: string, secondPortId: string): void {
    const first = this.graph.getPort(firstPortId);
    const second = this.graph.getPort(secondPortId);
    if (!first || !second || first.id === second.id) {
      this.setStatus("Connection cancelled.");
      return;
    }
    if (first.direction === second.direction) {
      this.setStatus("A connection must go from Output to Input.");
      return;
    }
    const [output, input] = first.direction === "Output" ? [first, second] : [second, first];
    const result = this.graph.connect(output.id, input.id);
    this.setStatus(result.success ? `Connected ${output.displayName} → ${input.displayName}.` : result.message);
  }

  setNumberWidget(nodeId: string, widgetIndex: number, value: number): void {
    const node = this.graph.getNode(nodeId);
    const widget = node?.definition?.widgets?.[widgetIndex];
    if (node && widget?.kind === "number" && widget.get(node.state) !== value) {
      this.graph.setNodeState(nodeId, widget.set(node.state, value));
    }
  }

  runWidgetAction(nodeId: string, widgetIndex: number): void {
    const node = this.graph.getNode(nodeId);
    const widget = node?.definition?.widgets?.[widgetIndex];
    if (!node || widget?.kind !== "button") {
      return;
    }
    try {
      widget.action(node, this.graph);
    } catch (error) {
      this.setStatus(`${widget.label} failed: ${errorMessage(error)}`);
    }
  }

  // --- History ------------------------------------------------------------------

  undo(): void {
    this.setStatus(this.history.undo() ? "Undo." : "Nothing to undo.");
  }

  redo(): void {
    this.setStatus(this.history.redo() ? "Redo." : "Nothing to redo.");
  }

  /** Groups every change until `endInteraction()` into one undo step (e.g. a drag). */
  beginInteraction(): void {
    this.history.begin();
  }

  endInteraction(): void {
    this.history.end();
  }

  // --- Clipboard ----------------------------------------------------------------

  copy(nodeIds: Iterable<string>): boolean {
    const data = copyNodes(this.graph, nodeIds);
    if (!data) {
      return false;
    }
    this.clipboard = data;
    this.pasteCount = 0;
    this.update({ canPaste: true, status: `Copied ${data.nodes.length} node(s).` });
    return true;
  }

  cut(nodeIds: Iterable<string>): boolean {
    const ids = [...nodeIds];
    if (!this.copy(ids)) {
      return false;
    }
    this.deleteElements(ids, []);
    this.setStatus(`Cut ${ids.length} node(s).`);
    return true;
  }

  /**
   * Pastes the clipboard centered at `center` (graph coordinates), or offset from the
   * original position when no center is given. Returns the ids of the new nodes.
   */
  paste(center?: Vec2): string[] {
    const data = this.clipboard;
    if (!data) {
      return [];
    }
    let offset: Vec2;
    if (center) {
      offset = {
        x: center.x - (data.bounds.minX + data.bounds.maxX + NODE_SIZE_ESTIMATE.width) / 2,
        y: center.y - (data.bounds.minY + data.bounds.maxY + NODE_SIZE_ESTIMATE.height) / 2,
      };
    } else {
      this.pasteCount++;
      offset = { x: PASTE_STEP * this.pasteCount, y: PASTE_STEP * this.pasteCount };
    }
    return this.insert(data, offset, "Pasted");
  }

  duplicate(nodeIds: Iterable<string>): string[] {
    const data = copyNodes(this.graph, nodeIds);
    return data ? this.insert(data, { x: PASTE_STEP, y: PASTE_STEP }, "Duplicated") : [];
  }

  private insert(data: ClipboardData, offset: Vec2, verb: string): string[] {
    try {
      const ids = pasteNodes(this.graph, data, offset);
      this.setStatus(`${verb} ${ids.length} node(s).`);
      return ids;
    } catch (error) {
      this.setStatus(`${verb} failed: ${errorMessage(error)}`);
      return [];
    }
  }

  setSelectionCount(selectionCount: number): void {
    if (selectionCount !== this.state.selectionCount) {
      this.update({ selectionCount });
    }
  }

  setStatus(status: string): void {
    this.update({ status });
  }

  /**
   * Replaces the document with a generated graph: a column of Number nodes feeding
   * a grid of Add nodes, each wired to two nodes of the previous column.
   */
  async generateStressGraph(nodeCount = 1000): Promise<void> {
    if (!(await this.confirmDiscard())) {
      return;
    }
    const started = performance.now();
    const graph = new GraphModel(this.registry);
    const columns = Math.max(2, Math.round(Math.sqrt(nodeCount / 1.6)));
    const rows = Math.ceil(nodeCount / columns);
    graph.batch(() => {
      const grid: string[][] = [];
      let created = 0;
      for (let column = 0; column < columns; column++) {
        grid.push([]);
        for (let row = 0; row < rows && created < nodeCount; row++, created++) {
          const position = { x: column * 320, y: row * 150 };
          const node = graph.addNode(column === 0 ? "sample.number" : "sample.add", position);
          if (column === 0) {
            graph.setNodeState<NumberState>(node.id, { value: row });
          }
          grid[column].push(node.id);
        }
      }
      const output = (id: string) => graph.getNode(id)!.outputs[0].id;
      for (let column = 1; column < grid.length; column++) {
        const previous = grid[column - 1];
        grid[column].forEach((id, row) => {
          const node = graph.getNode(id)!;
          if (row < previous.length) {
            graph.connect(output(previous[row]), node.getPort("a")!.id);
          }
          if (previous.length > 0) {
            graph.connect(output(previous[(row + 1) % previous.length]), node.getPort("b")!.id);
          }
        });
      }
    });
    const elapsed = Math.round(performance.now() - started);
    this.replaceGraph(
      graph,
      null,
      `Generated ${graph.nodeCount} nodes and ${graph.connectionCount} connections in ${elapsed} ms.`,
      [],
      true,
    );
    this.update({ dirty: true });
  }

  // --- Internals ---------------------------------------------------------------

  private async confirmDiscard(): Promise<boolean> {
    return !this.state.dirty || this.files.confirm("Discard unsaved changes?");
  }

  private replaceGraph(
    graph: GraphModel,
    filePath: string | null,
    status: string,
    warnings: string[],
    frameAll: boolean,
  ): void {
    this.attach(graph);
    this.filePath = filePath;
    this.update({ status, warnings, dirty: false, fileName: null, filePath, selectionCount: 0 });
    for (const listener of this.graphReplacedListeners) {
      listener(graph, { frameAll });
    }
  }

  private attach(graph: GraphModel): void {
    this.unsubscribeGraph();
    this.currentGraph = graph;
    this.unsubscribeGraph = graph.subscribe((change) => this.onGraphChanged(change));
    this.history.attach(graph);
    this.syncCounts();
  }

  private onGraphChanged(change: GraphChange): void {
    if (change.kind === "viewportChanged") {
      return;
    }
    const structural = change.kind !== "nodeMoved" && change.kind !== "nodeStateChanged";
    if (structural) {
      this.syncCounts({ dirty: true });
    } else if (!this.state.dirty) {
      this.update({ dirty: true });
    }
  }

  private syncCounts(extra: Partial<EditorSnapshot> = {}): void {
    this.update({ nodeCount: this.graph.nodeCount, connectionCount: this.graph.connectionCount, ...extra });
  }

  private update(patch: Partial<EditorSnapshot>): void {
    const statusId = patch.status !== undefined ? this.state.statusId + 1 : this.state.statusId;
    this.state = { ...this.state, ...patch, statusId };
    // Bulk graph edits can produce thousands of changes in one task; notify React once.
    if (!this.notifyScheduled) {
      this.notifyScheduled = true;
      queueMicrotask(() => {
        this.notifyScheduled = false;
        for (const listener of this.listeners) {
          listener();
        }
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
