import type { GraphModel } from "./graph";
import { createNode, createPlaceholder, type NodeModel } from "./node";
import { type FieldSchema, isRecord, type NodeData, type NodeSchema } from "./schema";
import { newId, type NoteContent, type PortDirection, type Vec2 } from "./types";

interface ClipboardNode {
  /** Id of the copied node, so references between pasted nodes follow the copies. */
  originalId: string;
  schemaId: string;
  name: string;
  position: Vec2;
  data: NodeData;
  /** Only needed for placeholder nodes, whose ports cannot be derived from a schema. */
  placeholderPorts: { key: string; direction: PortDirection }[];
}

interface ClipboardAlias {
  /** A copied node (by index), or a node that stays in the graph: the paste links to it again. */
  node: { copied: number } | { existing: string };
  position: Vec2;
}

interface ClipboardNote extends NoteContent {
  position: Vec2;
}

/** A copied node or alias, by index. */
type ClipboardView = { node: number } | { alias: number };

interface ClipboardConnection {
  output: ClipboardView;
  outputPort: string;
  input: ClipboardView;
  inputPort: string;
}

export interface ClipboardData {
  nodes: ClipboardNode[];
  aliases: ClipboardAlias[];
  notes: ClipboardNote[];
  /** Only connections between copied views. */
  connections: ClipboardConnection[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PasteResult {
  /** New nodes, in clipboard order. */
  nodeIds: string[];
  /** New nodes, aliases and notes, e.g. to select them. */
  viewIds: string[];
}

/**
 * Copies views (node, alias and note ids). An alias copied with its node becomes an alias of the
 * copy; an alias copied alone pastes as another alias of the same node.
 */
export function copyViews(graph: GraphModel, viewIds: Iterable<string>): ClipboardData | null {
  const ids = [...new Set(viewIds)];
  const nodes = ids.map((id) => graph.getNode(id)).filter((node): node is NodeModel => !!node);
  const aliases = ids.map((id) => graph.getAlias(id)).filter((alias) => !!alias);
  const notes = ids.map((id) => graph.getNote(id)).filter((note) => !!note);
  if (nodes.length === 0 && aliases.length === 0 && notes.length === 0) {
    return null;
  }
  const nodeIndex = new Map(nodes.map((node, i) => [node.id, i]));
  const views = new Map<string, ClipboardView>();
  nodes.forEach((node, i) => views.set(node.id, { node: i }));
  aliases.forEach((alias, i) => views.set(alias.id, { alias: i }));

  const connections: ClipboardConnection[] = [];
  const seen = new Set<string>();
  for (const nodeId of new Set([...nodes.map((node) => node.id), ...aliases.map((alias) => alias.nodeId)])) {
    for (const connection of graph.getNodeConnections(nodeId)) {
      if (seen.has(connection.id)) continue;
      seen.add(connection.id);
      const output = views.get(connection.outputViewId);
      const input = views.get(connection.inputViewId);
      if (output && input) {
        connections.push({
          output,
          outputPort: graph.getPort(connection.outputPortId)!.key,
          input,
          inputPort: graph.getPort(connection.inputPortId)!.key,
        });
      }
    }
  }
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { position } of [...nodes, ...aliases, ...notes]) {
    bounds.minX = Math.min(bounds.minX, position.x);
    bounds.minY = Math.min(bounds.minY, position.y);
    bounds.maxX = Math.max(bounds.maxX, position.x);
    bounds.maxY = Math.max(bounds.maxY, position.y);
  }
  return {
    nodes: nodes.map((node) => ({
      originalId: node.id,
      schemaId: node.schemaId,
      name: node.name,
      position: { ...node.position },
      data: structuredClone(node.data),
      placeholderPorts: node.isPlaceholder ? node.ports.map((port) => ({ key: port.key, direction: port.direction })) : [],
    })),
    aliases: aliases.map((alias) => {
      const copied = nodeIndex.get(alias.nodeId);
      return { node: copied !== undefined ? { copied } : { existing: alias.nodeId }, position: { ...alias.position } };
    }),
    notes: notes.map((note) => ({ position: { ...note.position }, size: { ...note.size }, text: note.text, color: note.color })),
    connections,
    bounds,
  };
}

/**
 * Adds copies of the clipboard nodes and aliases shifted by `offset`. Nodes and list elements get
 * fresh GUIDs (port keys that embed element GUIDs are remapped), unique names get a suffix. Aliases
 * of nodes that are no longer in the graph are skipped.
 */
export function pasteViews(graph: GraphModel, data: ClipboardData, offset: Vec2): PasteResult {
  const takenNames = uniqueNames(graph);
  // Fresh GUIDs for every list element first, so references between pasted nodes can follow them.
  const allIds = new Map<string, string>();
  const prepared = data.nodes.map((entry) => {
    const ids = new Map<string, string>();
    const schema = graph.registry.getSchema(entry.schemaId);
    const nodeData = structuredClone(entry.data);
    if (schema) {
      for (const field of schema.fields) {
        nodeData[field.id] = regenerateIds(field, nodeData[field.id], ids);
      }
    }
    ids.forEach((fresh, old) => allIds.set(old, fresh));
    const nodeId = newId();
    allIds.set(entry.originalId, nodeId);
    return { entry, schema, nodeData, ids, nodeId };
  });

  const created: { node: NodeModel; ids: Map<string, string> }[] = prepared.map(({ entry, schema, nodeData, ids, nodeId }) => {
    let node: NodeModel;
    if (schema) {
      remapReferences(schema, nodeData, ids, allIds);
      node = createNode(graph.registry, entry.schemaId, nodeId, nodeData);
      node.name = schema.naming.unique && entry.name ? uniqueName(entry.name, takenNames) : entry.name;
    } else {
      node = createPlaceholder(nodeId, entry.schemaId, nodeData, entry.name, entry.placeholderPorts);
    }
    const position = { x: entry.position.x + offset.x, y: entry.position.y + offset.y };
    graph.addNode(node, position);
    return { node, ids };
  });

  const noIds = new Map<string, string>();
  const createdAliases = data.aliases.map((entry) => {
    const source = "copied" in entry.node ? created[entry.node.copied] : { node: graph.getNode(entry.node.existing), ids: noIds };
    if (!source?.node) {
      return null;
    }
    const alias = graph.addAlias(source.node.id, { x: entry.position.x + offset.x, y: entry.position.y + offset.y });
    return { node: source.node, ids: source.ids, viewId: alias.id };
  });
  const resolve = (view: ClipboardView) =>
    "node" in view ? { ...created[view.node], viewId: created[view.node].node.id } : createdAliases[view.alias];

  for (const connection of data.connections) {
    const output = resolve(connection.output);
    const input = resolve(connection.input);
    const outputPort = output?.node.getPort(remapKey(connection.outputPort, output.ids));
    const inputPort = input?.node.getPort(remapKey(connection.inputPort, input.ids));
    if (output && input && outputPort && inputPort) {
      graph.connect(outputPort.id, inputPort.id, undefined, { output: output.viewId, input: input.viewId });
    }
  }
  const noteIds = data.notes.map(
    (entry) => graph.addNote({ x: entry.position.x + offset.x, y: entry.position.y + offset.y }, { text: entry.text, color: entry.color, size: { ...entry.size } }).id,
  );
  const nodeIds = created.map(({ node }) => node.id);
  return { nodeIds, viewIds: [...nodeIds, ...createdAliases.flatMap((alias) => (alias ? [alias.viewId] : [])), ...noteIds] };
}

/**
 * Matrix keys name elements of this node's own lists; item and node references may point into any
 * pasted node. References to elements or nodes that were not copied keep pointing at the originals.
 */
function remapReferences(schema: NodeSchema, data: NodeData, ownIds: Map<string, string>, allIds: Map<string, string>): void {
  const follow = (map: Map<string, string>, key: string) => map.get(key) ?? key;
  const visit = (field: FieldSchema, value: unknown): unknown => {
    if ((field.type === "itemRef" || field.type === "nodeRef") && typeof value === "string") {
      return follow(allIds, value);
    }
    if (field.type === "list" && Array.isArray(value)) {
      return value.map((item) => visit(field.item, item));
    }
    if (field.type === "record" && isRecord(value)) {
      const record = { ...value };
      for (const child of field.fields) {
        record[child.id] = visit(child, record[child.id]);
      }
      return record;
    }
    if (field.type === "matrix" && isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value).map(([row, cells]) => [
          follow(ownIds, row),
          isRecord(cells) ? Object.fromEntries(Object.entries(cells).map(([column, cell]) => [follow(ownIds, column), cell])) : cells,
        ]),
      );
    }
    return value;
  };
  for (const field of schema.fields) {
    data[field.id] = visit(field, data[field.id]);
  }
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

/**
 * Turns the copied nodes with the given original ids into linked copies (aliases) of those originals,
 * keeping the other nodes as copies. Connections between pasted views are kept, now drawn at the
 * aliases; aliases that pointed at a linked node point at its original.
 */
export function linkCopiedNodes(data: ClipboardData, originalIds: ReadonlySet<string>): ClipboardData {
  const nodes: ClipboardNode[] = [];
  const nodeIndex = new Map<number, number>();
  const aliases: ClipboardAlias[] = data.aliases.map((alias) => ({ ...alias }));
  const aliasIndex = new Map<number, number>();
  data.nodes.forEach((node, index) => {
    if (originalIds.has(node.originalId)) {
      aliasIndex.set(index, aliases.length);
      aliases.push({ node: { existing: node.originalId }, position: { ...node.position } });
    } else {
      nodeIndex.set(index, nodes.length);
      nodes.push(node);
    }
  });
  data.aliases.forEach((alias, index) => {
    if ("copied" in alias.node) {
      const copied = alias.node.copied;
      aliases[index] = {
        ...alias,
        node: nodeIndex.has(copied) ? { copied: nodeIndex.get(copied)! } : { existing: data.nodes[copied].originalId },
      };
    }
  });
  const view = (entry: ClipboardView): ClipboardView =>
    "node" in entry ? (nodeIndex.has(entry.node) ? { node: nodeIndex.get(entry.node)! } : { alias: aliasIndex.get(entry.node)! }) : entry;
  return {
    ...data,
    nodes,
    aliases,
    connections: data.connections.map((connection) => ({ ...connection, output: view(connection.output), input: view(connection.input) })),
  };
}
