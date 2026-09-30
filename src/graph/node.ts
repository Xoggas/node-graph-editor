import type { GraphModel } from "./graph";
import { t } from "../i18n";
import type { SchemaRegistry } from "./registry";
import { createData, derivePorts, type NodeData, type NodeSchema } from "./schema";
import { isValidId, newId, type Port, type PortDirection, RegistryError, type Vec2 } from "./types";

export class NodeModel {
  position: Vec2 = { x: 0, y: 0 };
  ports: Port[] = [];
  /** @internal set by GraphModel */
  graph: GraphModel | null = null;
  /** Schema version the node was saved with; written back unchanged for placeholder nodes. */
  loadedSchemaVersion: number | null = null;

  constructor(
    readonly id: string,
    readonly schemaId: string,
    /** Null for placeholder nodes whose schema is not in the loaded pack. */
    readonly schema: NodeSchema | null,
    public data: NodeData,
    public name: string = "",
  ) {
    if (!isValidId(id)) {
      throw new RegistryError(t("A node id must be a non-empty GUID."));
    }
  }

  get isPlaceholder(): boolean {
    return this.schema === null;
  }

  /** Header text: the custom name for renamable schemas, otherwise the schema title. */
  get displayName(): string {
    if (!this.schema) {
      return `Missing: ${this.schemaId}`;
    }
    return this.schema.naming.editable && this.name.trim() ? this.name : this.schema.title;
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

export function portId(nodeId: string, key: string): string {
  return `${nodeId}/${key}`;
}

/** Ports of a schema node for its current data. */
export function buildPorts(node: NodeModel, registry: SchemaRegistry): Port[] {
  if (!node.schema) {
    return node.ports;
  }
  return derivePorts(node.schema, node.data, registry.portTypes).map((port) => ({
    id: portId(node.id, port.key),
    key: port.key,
    direction: port.direction,
    capacity: port.capacity,
    typeId: port.type,
    displayName: port.label,
    nodeId: node.id,
  }));
}

/** Re-reads port names from the schema, e.g. after the interface language changed. */
export function relabelPorts(node: NodeModel, registry: SchemaRegistry): void {
  if (!node.schema) return;
  const labels = new Map(derivePorts(node.schema, node.data, registry.portTypes).map((port) => [port.key, port.label]));
  for (const port of node.ports) {
    const label = labels.get(port.key);
    if (label !== undefined) port.displayName = label;
  }
}

export function createNode(registry: SchemaRegistry, schemaId: string, id: string = newId(), data?: NodeData): NodeModel {
  const schema = registry.getSchema(schemaId);
  if (!schema) {
    throw new RegistryError(t("Unknown node schema '{type}'.", { type: schemaId }));
  }
  const node = new NodeModel(id, schemaId, schema, data ?? createData(schema));
  node.ports = buildPorts(node, registry);
  return node;
}

/**
 * A node whose schema is missing. Its data is kept verbatim; ports are recreated from the
 * connections that reference it so those connections survive a save.
 */
export function createPlaceholder(
  id: string,
  schemaId: string,
  data: NodeData,
  name: string,
  portKeys: { key: string; direction: PortDirection }[],
): NodeModel {
  const node = new NodeModel(id, schemaId, null, data, name);
  const seen = new Set<string>();
  for (const { key, direction } of portKeys) {
    if (!seen.has(key)) {
      seen.add(key);
      node.ports.push({
        id: portId(id, key),
        key,
        direction,
        capacity: "Multiple",
        typeId: "",
        displayName: key,
        nodeId: id,
      });
    }
  }
  return node;
}
