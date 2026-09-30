import type { GraphModel } from "./graph";
import { createNode, createPlaceholder, type NodeModel } from "./node";
import { type FieldSchema, isRecord, type NodeData } from "./schema";
import { newId, type PortDirection, type Vec2 } from "./types";

interface ClipboardNode {
  schemaId: string;
  name: string;
  position: Vec2;
  data: NodeData;
  /** Only needed for placeholder nodes, whose ports cannot be derived from a schema. */
  placeholderPorts: { key: string; direction: PortDirection }[];
}

interface ClipboardConnection {
  outputNode: number;
  outputPort: string;
  inputNode: number;
  inputPort: string;
}

export interface ClipboardData {
  nodes: ClipboardNode[];
  /** Only connections between copied nodes. */
  connections: ClipboardConnection[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function copyNodes(graph: GraphModel, nodeIds: Iterable<string>): ClipboardData | null {
  const nodes = [...new Set(nodeIds)].map((id) => graph.getNode(id)).filter((node): node is NodeModel => !!node);
  if (nodes.length === 0) {
    return null;
  }
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const connections: ClipboardConnection[] = [];
  for (const node of nodes) {
    for (const port of node.outputs) {
      for (const connection of graph.getPortConnections(port.id)) {
        const inputNode = index.get(connection.inputNodeId);
        const inputPort = graph.getPort(connection.inputPortId);
        if (connection.outputPortId === port.id && inputNode !== undefined && inputPort) {
          connections.push({ outputNode: index.get(node.id)!, outputPort: port.key, inputNode, inputPort: inputPort.key });
        }
      }
    }
  }
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { position } of nodes) {
    bounds.minX = Math.min(bounds.minX, position.x);
    bounds.minY = Math.min(bounds.minY, position.y);
    bounds.maxX = Math.max(bounds.maxX, position.x);
    bounds.maxY = Math.max(bounds.maxY, position.y);
  }
  return {
    nodes: nodes.map((node) => ({
      schemaId: node.schemaId,
      name: node.name,
      position: { ...node.position },
      data: structuredClone(node.data),
      placeholderPorts: node.isPlaceholder ? node.ports.map((port) => ({ key: port.key, direction: port.direction })) : [],
    })),
    connections,
    bounds,
  };
}

/**
 * Adds copies of the clipboard nodes shifted by `offset`. Nodes and list elements get fresh GUIDs
 * (port keys that embed element GUIDs are remapped), unique names get a suffix. Returns the new node ids.
 */
export function pasteNodes(graph: GraphModel, data: ClipboardData, offset: Vec2): string[] {
  const takenNames = uniqueNames(graph);
  const created: { node: NodeModel; ids: Map<string, string> }[] = data.nodes.map((entry) => {
    const ids = new Map<string, string>();
    const schema = graph.registry.getSchema(entry.schemaId);
    let node: NodeModel;
    if (schema) {
      const nodeData = structuredClone(entry.data);
      for (const field of schema.fields) {
        nodeData[field.id] = regenerateIds(field, nodeData[field.id], ids);
      }
      node = createNode(graph.registry, entry.schemaId, newId(), nodeData);
      node.name = schema.naming.unique && entry.name ? uniqueName(entry.name, takenNames) : entry.name;
    } else {
      node = createPlaceholder(newId(), entry.schemaId, structuredClone(entry.data), entry.name, entry.placeholderPorts);
    }
    const position = { x: entry.position.x + offset.x, y: entry.position.y + offset.y };
    graph.addNode(node, position);
    return { node, ids };
  });

  for (const connection of data.connections) {
    const output = created[connection.outputNode];
    const input = created[connection.inputNode];
    const outputPort = output?.node.getPort(remapKey(connection.outputPort, output.ids));
    const inputPort = input?.node.getPort(remapKey(connection.inputPort, input.ids));
    if (outputPort && inputPort) {
      graph.connect(outputPort.id, inputPort.id);
    }
  }
  return created.map(({ node }) => node.id);
}

function regenerateIds(field: FieldSchema, value: unknown, ids: Map<string, string>): unknown {
  if (field.type === "list" && Array.isArray(value)) {
    return value.map((item) => regenerateIds(field.item, item, ids));
  }
  if (field.type === "record" && isRecord(value)) {
    const record: Record<string, unknown> = { ...value };
    if (typeof value.id === "string") {
      const fresh = newId();
      ids.set(value.id, fresh);
      record.id = fresh;
    }
    for (const child of field.fields) {
      record[child.id] = regenerateIds(child, record[child.id], ids);
    }
    return record;
  }
  return value;
}

/** Repeated ports are keyed `<port>:<element id>`; follow the element to its new id. */
function remapKey(key: string, ids: Map<string, string>): string {
  const separator = key.indexOf(":");
  if (separator < 0) {
    return key;
  }
  const suffix = key.slice(separator + 1);
  return `${key.slice(0, separator)}:${ids.get(suffix) ?? suffix}`;
}

function uniqueNames(graph: GraphModel): Set<string> {
  const names = new Set<string>();
  for (const node of graph.nodes) {
    if (node.schema?.naming.unique && node.name) {
      names.add(node.name);
    }
  }
  return names;
}

function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let index = 2; taken.has(candidate); index++) {
    candidate = `${name} ${index}`;
  }
  taken.add(candidate);
  return candidate;
}
