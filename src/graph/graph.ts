import { makePort, NodeModel, createNode } from "./node";
import type { NodeGraphRegistry } from "./registry";
import {
  clampZoom,
  type Connection,
  type ConnectionFailureReason,
  type ConnectionResult,
  isValidId,
  newId,
  type Port,
  type PortDefinition,
  RegistryError,
  type UnresolvedConnection,
  type Vec2,
  type Viewport,
} from "./types";

export type GraphChange =
  | { kind: "nodeAdded"; node: NodeModel }
  | { kind: "nodeRemoved"; node: NodeModel }
  | { kind: "nodeMoved"; node: NodeModel; previous: Vec2 }
  | { kind: "nodeStateChanged"; node: NodeModel; previous: unknown }
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
    readonly registry: NodeGraphRegistry,
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

  addNode(typeId: string, position: Vec2): NodeModel;
  addNode(node: NodeModel, position?: Vec2): NodeModel;
  addNode(nodeOrType: NodeModel | string, position?: Vec2): NodeModel {
    const node = typeof nodeOrType === "string" ? createNode(this.registry.nodes, nodeOrType) : nodeOrType;
    if (node.graph) {
      throw new RegistryError(`Node '${node.id}' already belongs to a graph.`);
    }
    if (this.nodeMap.has(node.id)) {
      throw new RegistryError(`Node id '${node.id}' already exists in this graph.`);
    }
    for (const port of node.ports) {
      if (!isValidId(port.id) || this.portMap.has(port.id)) {
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

  setNodeState<S>(nodeId: string, state: S): boolean {
    const node = this.nodeMap.get(nodeId) as NodeModel<S> | undefined;
    if (!node || node.isPlaceholder) {
      return false;
    }
    const previous = node.state;
    node.state = state;
    this.emit({ kind: "nodeStateChanged", node, previous });
    return true;
  }

  addDynamicPort(nodeId: string, definition: PortDefinition): Port {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new RegistryError(`Node '${nodeId}' is not part of this graph.`);
    }
    if (node.ports.some((port) => port.key === definition.key)) {
      throw new RegistryError(`Node '${node.typeId}' already contains port '${definition.key}'.`);
    }
    this.registry.dataTypes.resolve(definition.typeId);
    const port = makePort(node.id, definition, true);
    const previous = node.ports;
    node.ports = [...node.ports, port];
    this.portMap.set(port.id, port);
    this.emit({ kind: "nodePortsChanged", node, previous });
    return port;
  }

  removeDynamicPort(portId: string): boolean {
    const port = this.portMap.get(portId);
    const node = port && this.nodeMap.get(port.nodeId);
    if (!port || !node || !port.isDynamic || this.hasConnections(portId)) {
      return false;
    }
    const previous = node.ports;
    node.ports = node.ports.filter((candidate) => candidate.id !== portId);
    this.portMap.delete(portId);
    this.emit({ kind: "nodePortsChanged", node, previous });
    return true;
  }

  /**
   * Replaces a node's port list, e.g. to undo a dynamic port change.
   * Ports that disappear must not have connections.
   */
  setNodePorts(nodeId: string, ports: readonly Port[]): void {
    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new RegistryError(`Node '${nodeId}' is not part of this graph.`);
    }
    const nextIds = new Set(ports.map((port) => port.id));
    for (const port of node.ports) {
      if (!nextIds.has(port.id) && this.hasConnections(port.id)) {
        throw new RegistryError(`Port '${port.key}' still has connections.`);
      }
    }
    for (const port of ports) {
      const existing = this.portMap.get(port.id);
      if (port.nodeId !== nodeId || (existing && existing.nodeId !== nodeId)) {
        throw new RegistryError(`Port id '${port.id}' is already used in this graph.`);
      }
    }
    const previous = node.ports;
    for (const port of previous) {
      if (!nextIds.has(port.id)) {
        this.portMap.delete(port.id);
        this.connectionsByPort.delete(port.id);
      }
    }
    node.ports = [...ports];
    for (const port of node.ports) {
      this.portMap.set(port.id, port);
    }
    this.emit({ kind: "nodePortsChanged", node, previous });
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
    const types = this.registry.dataTypes;
    const outputKnown = types.has(output.typeId);
    const inputKnown = types.has(input.typeId);
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

function fail(reason: ConnectionFailureReason, message: string): ConnectionResult {
  return { success: false, reason, message };
}
