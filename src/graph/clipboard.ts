import type { GraphModel } from "./graph";
import { createNode, createPlaceholder, makePort, type NodeModel } from "./node";
import { newId, type PortSnapshot, type Vec2 } from "./types";

interface ClipboardNode {
  typeId: string;
  position: Vec2;
  ports: PortSnapshot[];
  /** JSON-safe state (captured through the node definition). */
  state: Record<string, unknown>;
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
      typeId: node.typeId,
      position: { ...node.position },
      ports: node.ports.map(({ nodeId: _nodeId, ...snapshot }) => snapshot),
      state: captureState(node),
    })),
    connections,
    bounds,
  };
}

/** Adds copies of the clipboard nodes with fresh ids, shifted by `offset`. Returns the new node ids. */
export function pasteNodes(graph: GraphModel, data: ClipboardData, offset: Vec2): string[] {
  const created: NodeModel[] = data.nodes.map((entry) => {
    const position = { x: entry.position.x + offset.x, y: entry.position.y + offset.y };
    return graph.addNode(instantiate(graph, entry), position);
  });
  for (const connection of data.connections) {
    const output = created[connection.outputNode]?.getPort(connection.outputPort);
    const input = created[connection.inputNode]?.getPort(connection.inputPort);
    if (output && input) {
      graph.connect(output.id, input.id);
    }
  }
  return created.map((node) => node.id);
}

function instantiate(graph: GraphModel, entry: ClipboardNode): NodeModel {
  const definition = graph.registry.nodes.get(entry.typeId);
  if (!definition) {
    const id = newId();
    return createPlaceholder(
      id,
      entry.typeId,
      structuredClone(entry.state),
      entry.ports.map((port) => ({ ...port, id: newId() })),
    );
  }
  const node = createNode(graph.registry.nodes, entry.typeId);
  // Keep static ports from the definition, restore dynamic ones and display names from the copy.
  const dynamic = entry.ports.filter((port) => port.isDynamic);
  node.ports = node.ports.filter((port) => !port.isDynamic);
  for (const port of node.ports) {
    const copied = entry.ports.find((candidate) => candidate.key === port.key && !candidate.isDynamic);
    if (copied) {
      port.displayName = copied.displayName;
    }
  }
  for (const port of dynamic) {
    if (graph.registry.dataTypes.has(port.typeId)) {
      node.ports.push(makePort(node.id, port, true));
    }
  }
  node.state = definition.restoreState ? definition.restoreState(structuredClone(entry.state)) : structuredClone(entry.state);
  return node;
}

function captureState(node: NodeModel): Record<string, unknown> {
  if (node.isPlaceholder) {
    return structuredClone(node.rawState ?? {});
  }
  const capture = node.definition?.captureState;
  const state = capture ? capture(node.state) : node.state;
  return typeof state === "object" && state !== null ? structuredClone(state as Record<string, unknown>) : {};
}
