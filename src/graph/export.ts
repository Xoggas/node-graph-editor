import type { GraphModel } from "./graph";
import { t } from "../i18n";
import { localizationKey } from "./localization";
import type { NodeModel } from "./node";
import { type FieldSchema, isRecord, type NodeData } from "./schema";

export const RUNTIME_FORMAT = "node-graph-runtime";
export const RUNTIME_FORMAT_VERSION = 1;

/**
 * Port key → the places connected to it; ports without connections are omitted. A place is a node id,
 * or the id of a linked copy (see `RuntimeGraph.aliases`).
 */
export type RuntimeConnections = Record<string, string[]>;

export interface RuntimeNode {
  type: string;
  data: NodeData;
  /** Connections of the node itself. */
  inputs?: RuntimeConnections;
  outputs?: RuntimeConnections;
}

/** A linked copy: the node `node` (same data and id) at another place, with connections of its own. */
export interface RuntimeAlias {
  node: string;
  inputs?: RuntimeConnections;
  outputs?: RuntimeConnections;
}

export interface RuntimeGraph {
  format: typeof RUNTIME_FORMAT;
  version: typeof RUNTIME_FORMAT_VERSION;
  graph: string;
  pack: string | null;
  /** The node execution starts from (the pack's `export.entry` schema), when present. */
  entry?: string;
  /**
   * Schema `meta` per node type that has any, written once instead of per node; omitted when no type
   * has meta. Flags such as `blocking` stay in the schema pack, which the game reads anyway.
   */
  types?: Record<string, Record<string, unknown>>;
  nodes: Record<string, RuntimeNode>;
  /** Linked copies by id; omitted when there are none. */
  aliases?: Record<string, RuntimeAlias>;
}

export interface RuntimeExport {
  graph: RuntimeGraph;
  /** Problems the engine may trip over; they do not stop the export. */
  warnings: string[];
}

/**
 * The engine version of a graph: no positions, names, viewport or other editor data; connections
 * are stored on the nodes; localized texts carry their resolved localization key.
 */
export function exportRuntimeGraph(graph: GraphModel): RuntimeExport {
  const warnings: string[] = [];
  const pack = graph.registry.pack;
  const types: RuntimeGraph["types"] = {};
  const nodes: RuntimeGraph["nodes"] = {};

  for (const node of graph.nodes) {
    const label = node.name || node.schema?.title || node.schemaId;
    if (!node.schema) {
      warnings.push(t("'{node}' has no schema ('{type}') and is exported as-is.", { node: label, type: node.schemaId }));
    } else if (Object.keys(node.schema.meta).length > 0) {
      types[node.schemaId] = node.schema.meta;
    }
    const runtime: RuntimeNode = { type: node.schemaId, data: node.schema ? exportData(graph, node, warnings) : node.data };
    Object.assign(runtime, viewConnections(graph, node, node.id));
    nodes[node.id] = runtime;
  }
  const aliases: Record<string, RuntimeAlias> = {};
  for (const alias of graph.aliases) {
    aliases[alias.id] = { node: alias.nodeId, ...viewConnections(graph, graph.getNode(alias.nodeId)!, alias.id) };
  }

  const result: RuntimeGraph = { format: RUNTIME_FORMAT, version: RUNTIME_FORMAT_VERSION, graph: graph.id, pack: pack?.id ?? null, nodes };
  if (Object.keys(types).length > 0) result.types = types;
  if (Object.keys(aliases).length > 0) result.aliases = aliases;
  const entrySchema = pack?.exportEntry;
  if (entrySchema) {
    const entries = [...graph.nodes].filter((node) => node.schemaId === entrySchema);
    if (entries.length === 0) {
      warnings.push(t("There is no '{type}' node to start from.", { type: pack.nodes.get(entrySchema)?.title ?? entrySchema }));
    } else {
      result.entry = entries[0].id;
      if (entries.length > 1) warnings.push(t("There are {count} start nodes; the first one is used.", { count: entries.length }));
    }
  }
  if (graph.unresolvedConnections.length > 0) {
    warnings.push(t("{count} unresolved connection(s) are not exported.", { count: graph.unresolvedConnections.length }));
  }
  return { graph: result, warnings };
}

/** Connections of one view of a node (the node itself or a linked copy), to the views at the other end. */
function viewConnections(graph: GraphModel, node: NodeModel, viewId: string): Pick<RuntimeNode, "inputs" | "outputs"> {
  const collect = (direction: "Input" | "Output") => {
    const result: RuntimeConnections = {};
    for (const port of node.ports) {
      if (port.direction !== direction) continue;
      const targets: string[] = [];
      for (const connection of graph.getPortConnections(port.id)) {
        if (direction === "Output" && connection.outputPortId === port.id && connection.outputViewId === viewId) targets.push(connection.inputViewId);
        if (direction === "Input" && connection.inputPortId === port.id && connection.inputViewId === viewId) targets.push(connection.outputViewId);
      }
      if (targets.length > 0) result[port.key] = targets;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
  const result: Pick<RuntimeNode, "inputs" | "outputs"> = {};
  const inputs = collect("Input");
  const outputs = collect("Output");
  if (inputs) result.inputs = inputs;
  if (outputs) result.outputs = outputs;
  return result;
}

/** Node data with localized texts replaced by their keys and references checked. */
function exportData(graph: GraphModel, node: NodeModel, warnings: string[]): NodeData {
  const label = node.name || node.schema!.title;
  const visit = (field: FieldSchema, value: unknown, path: (string | number)[]): unknown => {
    switch (field.type) {
      case "localizedText": {
        const key = localizationKey(node, field, path, value);
        if (!key) warnings.push(t("'{node}' → {field}: no localization key (the node has no name).", { node: label, field: field.label }));
        return key;
      }
      case "nodeRef":
        if (typeof value === "string" && !graph.getNode(value)) warnings.push(t("'{node}' → {field}: the referenced node was deleted.", { node: label, field: field.label }));
        return value;
      case "itemRef":
        if (typeof value === "string" && !graph.findItem(value)) warnings.push(t("'{node}' → {field}: the referenced element was deleted.", { node: label, field: field.label }));
        return value;
      case "resource":
        if (typeof value === "string" && !graph.registry.pack?.resources.items.has(value)) {
          warnings.push(t("'{node}' → {field}: resource '{id}' is not in the library.", { node: label, field: field.label, id: value }));
        }
        return value;
      case "list":
        return Array.isArray(value) ? value.map((item, index) => visit(field.item, item, [...path, index])) : value;
      case "record": {
        if (!isRecord(value)) return value;
        const record: Record<string, unknown> = { ...value };
        for (const child of field.fields) record[child.id] = visit(child, value[child.id], [...path, child.id]);
        return record;
      }
      default:
        return value;
    }
  };
  const data: NodeData = {};
  for (const field of node.schema!.fields) {
    data[field.id] = visit(field, node.data[field.id], [field.id]);
  }
  return data;
}
