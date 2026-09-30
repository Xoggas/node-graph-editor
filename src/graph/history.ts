import type { GraphChange, GraphModel } from "./graph";
import type { Vec2 } from "./types";

interface Step {
  undo(graph: GraphModel): void;
  redo(graph: GraphModel): void;
}

interface Transaction {
  steps: Step[];
  /** Index of the coalesced move step per node, so a drag becomes one step per node. */
  moves: Map<string, { step: Step; to: Vec2 }>;
}

const MAX_ENTRIES = 200;

/**
 * Undo/redo built from graph change events. Changes made in the same task form one entry;
 * `begin()`/`end()` span an entry across tasks (e.g. a node drag).
 */
export class GraphHistory {
  private undoStack: Step[][] = [];
  private redoStack: Step[][] = [];
  private current: Transaction | null = null;
  private explicitDepth = 0;
  private flushScheduled = false;
  private applying = false;
  private unsubscribe: () => void = () => {};
  private graph: GraphModel | null = null;

  constructor(private readonly onChange: () => void = () => {}) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0 || (this.current?.steps.length ?? 0) > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  attach(graph: GraphModel): void {
    this.unsubscribe();
    this.graph = graph;
    this.clear();
    this.unsubscribe = graph.subscribe((change) => this.record(change));
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
    this.explicitDepth = 0;
    this.onChange();
  }

  begin(): void {
    this.explicitDepth++;
  }

  end(): void {
    if (this.explicitDepth > 0 && --this.explicitDepth === 0) {
      this.commit();
    }
  }

  undo(): boolean {
    this.commit();
    const entry = this.undoStack.pop();
    if (!entry || !this.graph) {
      return false;
    }
    this.apply(() => {
      for (let i = entry.length - 1; i >= 0; i--) {
        entry[i].undo(this.graph!);
      }
    });
    this.redoStack.push(entry);
    this.onChange();
    return true;
  }

  redo(): boolean {
    this.commit();
    const entry = this.redoStack.pop();
    if (!entry || !this.graph) {
      return false;
    }
    this.apply(() => entry.forEach((step) => step.redo(this.graph!)));
    this.undoStack.push(entry);
    this.onChange();
    return true;
  }

  private apply(action: () => void): void {
    this.applying = true;
    try {
      action();
    } finally {
      this.applying = false;
    }
  }

  private record(change: GraphChange): void {
    if (this.applying || change.kind === "viewportChanged") {
      return;
    }
    if (change.kind === "reset") {
      this.clear();
      return;
    }
    const transaction = this.open();
    if (change.kind === "nodeMoved") {
      const nodeId = change.node.id;
      const to = { ...change.node.position };
      const existing = transaction.moves.get(nodeId);
      if (existing) {
        existing.to = to;
        return;
      }
      const from = { ...change.previous };
      const move = { step: null as unknown as Step, to };
      move.step = {
        undo: (graph) => graph.moveNode(nodeId, from),
        redo: (graph) => graph.moveNode(nodeId, move.to),
      };
      transaction.moves.set(nodeId, move);
      transaction.steps.push(move.step);
      return;
    }
    const step = createStep(change);
    if (step) {
      transaction.steps.push(step);
    }
  }

  private open(): Transaction {
    if (!this.current) {
      this.current = { steps: [], moves: new Map() };
    }
    if (this.explicitDepth === 0 && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => {
        this.flushScheduled = false;
        if (this.explicitDepth === 0) {
          this.commit();
        }
      });
    }
    return this.current;
  }

  private commit(): void {
    const transaction = this.current;
    this.current = null;
    if (!transaction || transaction.steps.length === 0) {
      return;
    }
    this.undoStack.push(transaction.steps);
    if (this.undoStack.length > MAX_ENTRIES) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.onChange();
  }
}

function createStep(change: GraphChange): Step | null {
  switch (change.kind) {
    case "nodeAdded": {
      const { node } = change;
      const position = { ...node.position };
      return {
        undo: (graph) => graph.removeNode(node.id),
        redo: (graph) => graph.addNode(node, position),
      };
    }
    case "nodeRemoved": {
      const { node } = change;
      const position = { ...node.position };
      return {
        undo: (graph) => graph.addNode(node, position),
        redo: (graph) => graph.removeNode(node.id),
      };
    }
    case "nodeDataChanged": {
      const { node, previous } = change;
      const next = node.data;
      return {
        undo: (graph) => graph.setNodeData(node.id, previous),
        redo: (graph) => graph.setNodeData(node.id, next),
      };
    }
    case "nodeRenamed": {
      const { node, previous } = change;
      const next = node.name;
      return {
        undo: (graph) => graph.renameNode(node.id, previous),
        redo: (graph) => graph.renameNode(node.id, next),
      };
    }
    case "connectionAdded": {
      const { connection } = change;
      return {
        undo: (graph) => graph.disconnect(connection.id),
        redo: (graph) => graph.connect(connection.outputPortId, connection.inputPortId, connection.id),
      };
    }
    case "connectionRemoved": {
      const { connection } = change;
      return {
        undo: (graph) => graph.connect(connection.outputPortId, connection.inputPortId, connection.id),
        redo: (graph) => graph.disconnect(connection.id),
      };
    }
    // Ports are derived from data; restoring the data restores them.
    default:
      return null;
  }
}
