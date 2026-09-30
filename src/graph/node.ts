import type { GraphModel } from "./graph";
import type { DataTypeRegistry, NodeDefinition, NodeTypeRegistry } from "./registry";
import {
  isValidId,
  newId,
  NodeSchemaMismatchError,
  type Port,
  type PortDefinition,
  type PortSnapshot,
  RegistryError,
  type Vec2,
} from "./types";

export class NodeModel<S = any> {
  position: Vec2 = { x: 0, y: 0 };
  ports: Port[] = [];
  /** @internal set by GraphModel */
  graph: GraphModel | null = null;

  constructor(
    readonly id: string,
    readonly typeId: string,
    /** Null for placeholder nodes whose type is not registered. */
    readonly definition: NodeDefinition<S> | null,
    public state: S,
    /** Verbatim JSON state of a placeholder node, written back unchanged on save. */
    readonly rawState: Record<string, unknown> | null = null,
  ) {
    if (!isValidId(id)) {
      throw new RegistryError("A node id must be a non-empty GUID.");
    }
  }

  get isPlaceholder(): boolean {
    return this.definition === null;
  }

  get displayName(): string {
    if (!this.definition) {
      return `Missing: ${this.typeId}`;
    }
    return this.definition.displayName?.trim() || this.typeId;
  }

  getPort(key: string): Port | undefined {
    return this.ports.find((port) => port.key === key);
  }

  get inputs(): Port[] {
    return this.ports.filter((port) => port.direction === "Input");
  }

  get outputs(): Port[] {
    return this.ports.filter((port) => port.direction === "Output");
  }
}

export function makePort(
  nodeId: string,
  definition: PortDefinition,
  isDynamic: boolean,
  id: string = newId(),
): Port {
  if (!definition.key.trim()) {
    throw new RegistryError("A port key is required.");
  }
  return {
    id,
    key: definition.key,
    direction: definition.direction,
    capacity: definition.capacity ?? (definition.direction === "Input" ? "Single" : "Multiple"),
    typeId: definition.typeId,
    displayName: definition.displayName?.trim() || definition.key,
    isDynamic,
    nodeId,
  };
}

export function createNode(registry: NodeTypeRegistry, typeId: string, id: string = newId()): NodeModel {
  const definition = registry.get(typeId);
  if (!definition) {
    throw new RegistryError(`Unknown node type '${typeId}'.`);
  }
  const node = new NodeModel(id, typeId, definition, definition.defaultState());
  const keys = new Set<string>();
  const add = (portDefinition: PortDefinition, isDynamic: boolean) => {
    if (keys.has(portDefinition.key)) {
      throw new RegistryError(`Node '${typeId}' already contains port '${portDefinition.key}'.`);
    }
    registry.dataTypes.resolve(portDefinition.typeId);
    keys.add(portDefinition.key);
    node.ports.push(makePort(id, portDefinition, isDynamic));
  };
  definition.ports?.forEach((port) => add(port, false));
  definition.initialDynamicPorts?.forEach((port) => add(port, true));
  return node;
}

/**
 * Applies saved port ids and dynamic ports to a freshly created node.
 * Static ports must match the node definition exactly, otherwise the document is considered out of date.
 */
export function restorePorts(node: NodeModel, snapshots: readonly PortSnapshot[], dataTypes: DataTypeRegistry): void {
  const staticPorts = new Map(node.ports.filter((port) => !port.isDynamic).map((port) => [port.key, port]));
  const seenKeys = new Set<string>();
  const seenIds = new Set<string>();
  const restored: Port[] = [];

  for (const snapshot of snapshots) {
    if (!isValidId(snapshot.id)) {
      throw new RegistryError(`Node '${node.id}' contains an empty port id.`);
    }
    if (seenKeys.has(snapshot.key)) {
      throw new RegistryError(`Node '${node.id}' contains duplicate port key '${snapshot.key}'.`);
    }
    if (seenIds.has(snapshot.id)) {
      throw new RegistryError(`Node '${node.id}' contains duplicate port id '${snapshot.id}'.`);
    }
    seenKeys.add(snapshot.key);
    seenIds.add(snapshot.id);
    dataTypes.resolve(snapshot.typeId);

    const staticPort = staticPorts.get(snapshot.key);
    if (!snapshot.isDynamic) {
      if (!staticPort) {
        throw new NodeSchemaMismatchError(`Static port '${snapshot.key}' is not declared by '${node.typeId}'.`);
      }
      if (
        staticPort.direction !== snapshot.direction ||
        staticPort.capacity !== snapshot.capacity ||
        staticPort.typeId !== snapshot.typeId
      ) {
        throw new NodeSchemaMismatchError(`Static port '${snapshot.key}' does not match the '${node.typeId}' schema.`);
      }
      restored.push({ ...staticPort, id: snapshot.id, displayName: snapshot.displayName || snapshot.key });
      continue;
    }

    if (staticPort) {
      throw new NodeSchemaMismatchError(`Dynamic port '${snapshot.key}' conflicts with a static port.`);
    }
    restored.push({ ...snapshot, nodeId: node.id });
  }

  for (const key of staticPorts.keys()) {
    if (!seenKeys.has(key)) {
      throw new NodeSchemaMismatchError(`Static port '${key}' is missing from the document.`);
    }
  }

  node.ports = restored;
}

export function createPlaceholder(
  id: string,
  typeId: string,
  rawState: Record<string, unknown>,
  snapshots: readonly PortSnapshot[],
): NodeModel<null> {
  const node = new NodeModel<null>(id, typeId, null, null, rawState);
  const ids = new Set<string>();
  for (const snapshot of snapshots) {
    if (!isValidId(snapshot.id) || ids.has(snapshot.id)) {
      throw new RegistryError(`Node '${id}' contains an invalid or duplicate port id.`);
    }
    ids.add(snapshot.id);
    node.ports.push({ ...snapshot, nodeId: id });
  }
  return node;
}
