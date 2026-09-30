import { buildPorts, createNode, type NodeModel } from "./node";
import type { SchemaRegistry } from "./registry";
import type { NodeData } from "./schema";
import {
  clampZoom,
  type Connection,
  type ConnectionFailureReason,
  type ConnectionResult,
  isValidId,
  newId,
  type Port,
  RegistryError,
  type UnresolvedConnection,
  type Vec2,
  type Viewport,
} from "./types";

export type GraphChange =
  | { kind: "nodeAdded"; node: NodeModel }
  | { kind: "nodeRemoved"; node: NodeModel }
  | { kind: "nodeMoved"; node: NodeModel; previous: Vec2 }
  | { kind: "nodeDataChanged"; node: NodeModel; previous: NodeData }
  | { kind: "nodeRenamed"; node: NodeModel; previous: string }
  /** Ports are derived from data, so this follows a `nodeDataChanged` that altered them. */
  | { kind: "nodePortsChanged"; node: NodeModel; previous: readonly Port[] }
  | { kind: "connectionAdded"; connection: Connection }
  | { kind: "connectionRemoved"; connection: Connection }
  | { kind: "viewportChanged" }
  /** Emitted once after `batch()` instead of the individual changes it suppressed. */
  | { kind: "reset" };

export type GraphListener = (change: GraphChange) => void;

const NO_CONNECTIONS: ReadonlySet<Connection> = new Set();

export class GraphModel {
  readonly unresolvedConnections: UnresolvedConnection[] = [];
  private readonly nodeMap = new Map<string, NodeModel>();
  private readonly portMap = new Map<string, Port>();
  private readonly connectionMap = new Map<string, Connection>();
  private readonly connectionsByPort = new Map<string, Set<Connection>>();
  private readonly listeners = new Set<GraphListener>();
  private batchDepth = 0;
  private batchChanged = false;
  private currentViewport: Viewport = { x: 0, y: 0, zoom: 1 };

  constructor(
    readonly registry: SchemaRegistry,
    readonly id: string = newId(),
  ) {
    if (!isValidId(id)) {
      throw new RegistryError("A graph id is required.");
    }
  }

  get nodes(): IterableIterator<NodeModel> {
    return this.nodeMap.values();
  }

  get nodeCount(): number {
    return this.nodeMap.size;
  }

  get connections(): IterableIterator<Connection> {
    return this.connectionMap.values();
  }

  get connectionCount(): number {
    return this.connectionMap.size;
  }

  get viewport(): Viewport {
    return this.currentViewport;
  }

  subscribe(listener: GraphListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Runs `action` without emitting individual changes; emits a single `reset` afterwards. */
  batch<T>(action: () => T): T {
    this.batchDepth++;
    try {
      return action();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.batchChanged) {
        this.batchChanged = false;
        this.emit({ kind: "reset" });
      }
    }
  }

  getNode(id: string): NodeModel | undefined {
    return this.nodeMap.get(id);
  }

  getPort(id: string): Port | undefined {
    return this.portMap.get(id);
  }

  getConnection(id: string): Connection | undefined {
    return this.connectionMap.get(id);
  }

  getPortConnections(portId: string): ReadonlySet<Connection> {
    return this.connectionsByPort.get(portId) ?? NO_CONNECTIONS;
  }

  hasConnections(portId: string): boolean {
    return this.getPortConnections(portId).size > 0;
  }

  getNodeConnections(nodeId: string): Connection[] {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return [];
    }
    const result = new Set<Connection>();
    for (const port of node.ports) {
      this.getPortConnections(port.id).forEach((connection) => result.add(connection));
    }
    return [...result];
  }

  /** Nodes that receive values from the given output port. */
  getOutputNodes(outputPortId: string): NodeModel[] {
    return [...this.getPortConnections(outputPortId)]
      .filter((connection) => connection.outputPortId === outputPortId)
      .map((connection) => this.nodeMap.get(connection.inputNodeId)!);
  }

  /** Nodes that feed values into the given input port. */
  getInputNodes(inputPortId: string): NodeModel[] {
    return [...this.getPortConnections(inputPortId)]
      .filter((connection) => connection.inputPortId === inputPortId)
      .map((connection) => this.nodeMap.get(connection.outputNodeId)!);
  }

  addNode(schemaId: string, position: Vec2): NodeModel;
  addNode(node: NodeModel, position?: Vec2): NodeModel;
  addNode(nodeOrSchema: NodeModel | string, position?: Vec2): NodeModel {
    const node = typeof nodeOrSchema === "string" ? createNode(this.registry, nodeOrSchema) : nodeOrSchema;
    if (node.graph) {
      throw new RegistryError(`Node '${node.id}' already belongs to a graph.`);
    }
    if (this.nodeMap.has(node.id)) {
      throw new RegistryError(`Node id '${node.id}' already exists in this graph.`);
    }
    for (const port of node.ports) {
      if (!port.id || this.portMap.has(port.id)) {
        throw new RegistryError(`Port id '${port.id}' is already used in this graph.`);
      }
    }

    if (position) {
      node.position = { x: position.x, y: position.y };
    }
    node.graph = this;
    this.nodeMap.set(node.id, node);
    for (const port of node.ports) {
      this.portMap.set(port.id, port);
    }
    this.emit({ kind: "nodeAdded", node });
    return node;
  }

  removeNode(nodeId: string): boolean {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return false;
    }
    for (const connection of this.getNodeConnections(nodeId)) {
      this.disconnect(connection.id);
    }
    for (const port of node.ports) {
      this.portMap.delete(port.id);
      this.connectionsByPort.delete(port.id);
    }
    this.nodeMap.delete(nodeId);
    node.graph = null;
    this.emit({ kind: "nodeRemoved", node });
    return true;
  }

  moveNode(nodeId: string, position: Vec2): boolean {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      return false;
    }
    if (node.position.x !== position.x || node.position.y !== position.y) {
      const previous = node.position;
      node.position = { x: position.x, y: position.y };
      this.emit({ kind: "nodeMoved", node, previous });
    }
    return true;
  }

  /**
   * Replaces a node's data and re-derives its ports. Connections on ports that disappear
   * (e.g. a removed list element) are disconnected first, so the change is fully undoable.
   */
  setNodeData(nodeId: string, data: NodeData): boolean {
    const node = this.nodeMap.get(nodeId);
    if (!node || node.isPlaceholder) {
      return false;
    }
    const previous = node.data;
    const previousPorts = node.ports;
    node.data = data;
    const nextPorts = buildPorts(node, this.registry);
    const nextIds = new Set(nextPorts.map((port) => port.id));
    node.data = previous;
    for (const port of previousPorts) {
      if (!nextIds.has(port.id)) {
        for (const connection of [...this.getPortConnections(port.id)]) {
          this.disconnect(connection.id);
        }
      }
    }

    node.data = data;
    this.emit({ kind: "nodeDataChanged", node, previous });
    if (!samePorts(previousPorts, nextPorts)) {
      for (const port of previousPorts) {
        if (!nextIds.has(port.id)) {
          this.portMap.delete(port.id);
          this.connectionsByPort.delete(port.id);
        }
      }
      node.ports = nextPorts;
      for (const port of nextPorts) {
        this.portMap.set(port.id, port);
      }
      this.emit({ kind: "nodePortsChanged", node, previous: previousPorts });
    }
    return true;
  }

  renameNode(nodeId: string, name: string): boolean {
    const node = this.nodeMap.get(nodeId);
    if (!node || node.name === name) {
      return false;
    }
    const previous = node.name;
    node.name = name;
    this.emit({ kind: "nodeRenamed", node, previous });
    return true;
  }

  /** Checks whether a connection is allowed without creating it. */
  canConnect(outputPortId: string, inputPortId: string): ConnectionResult | null {
    const output = this.portMap.get(outputPortId);
    const input = this.portMap.get(inputPortId);
    if (!output || !input) {
      return fail("MissingEndpoint", "The connection endpoint was not found.");
    }
    if (output.direction !== "Output" || input.direction !== "Input") {
      return fail("WrongDirection", "Connections must go from Output to Input.");
    }
    const types = this.registry;
    const outputKnown = types.hasPortType(output.typeId);
    const inputKnown = types.hasPortType(input.typeId);
    const hasPlaceholderEndpoint =
      this.nodeMap.get(output.nodeId)!.isPlaceholder || this.nodeMap.get(input.nodeId)!.isPlaceholder;
    if ((!outputKnown || !inputKnown) && !hasPlaceholderEndpoint) {
      return fail("UnknownDataType", "One of the port data types is not registered.");
    }
    if (outputKnown && inputKnown && !types.isAssignable(input.typeId, output.typeId)) {
      return fail("IncompatibleTypes", `'${output.typeId}' cannot be connected to '${input.typeId}'.`);
    }
    const inputConnections = this.getPortConnections(input.id);
    if (input.capacity === "Single" && inputConnections.size > 0) {
      return fail("InputCapacityReached", "The input port already has a connection.");
    }
    for (const connection of inputConnections) {
      if (connection.outputPortId === output.id) {
        return fail("DuplicateConnection", "This connection already exists.");
      }
    }
    if (output.capacity === "Single" && this.hasConnections(output.id)) {
      return fail("OutputCapacityReached", "The output port already has a connection.");
    }
    return null;
  }

  connect(outputPortId: string, inputPortId: string, connectionId?: string): ConnectionResult {
    const failure = this.canConnect(outputPortId, inputPortId);
    if (failure) {
      return failure;
    }
    if (connectionId !== undefined && (!isValidId(connectionId) || this.connectionMap.has(connectionId))) {
      return fail("DuplicateConnection", "A connection with this id already exists.");
    }

    const output = this.portMap.get(outputPortId)!;
    const input = this.portMap.get(inputPortId)!;
    const connection: Connection = {
      id: connectionId ?? newId(),
      outputPortId,
      inputPortId,
      outputNodeId: output.nodeId,
      inputNodeId: input.nodeId,
    };
    this.connectionMap.set(connection.id, connection);
    this.indexConnection(outputPortId, connection);
    this.indexConnection(inputPortId, connection);
    this.emit({ kind: "connectionAdded", connection });
    return { success: true, connection };
  }

  disconnect(connectionId: string): boolean {
    const connection = this.connectionMap.get(connectionId);
    if (!connection) {
      return false;
    }
    this.connectionMap.delete(connectionId);
    this.connectionsByPort.get(connection.outputPortId)?.delete(connection);
    this.connectionsByPort.get(connection.inputPortId)?.delete(connection);
    this.emit({ kind: "connectionRemoved", connection });
    return true;
  }

  setViewport(viewport: Viewport): void {
    this.currentViewport = { x: viewport.x, y: viewport.y, zoom: clampZoom(viewport.zoom) };
    this.emit({ kind: "viewportChanged" });
  }

  addUnresolvedConnection(connection: UnresolvedConnection): void {
    this.unresolvedConnections.push(connection);
  }

  private indexConnection(portId: string, connection: Connection): void {
    let set = this.connectionsByPort.get(portId);
    if (!set) {
      set = new Set();
      this.connectionsByPort.set(portId, set);
    }
    set.add(connection);
  }

  private emit(change: GraphChange): void {
    if (this.batchDepth > 0) {
      this.batchChanged = true;
      return;
    }
    for (const listener of this.listeners) {
      listener(change);
    }
  }
}

function samePorts(a: readonly Port[], b: readonly Port[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (port, index) =>
        port.id === b[index].id &&
        port.displayName === b[index].displayName &&
        port.typeId === b[index].typeId &&
        port.capacity === b[index].capacity &&
        port.direction === b[index].direction,
    )
  );
}

function fail(reason: ConnectionFailureReason, message: string): ConnectionResult {
  return { success: false, reason, message };
}
