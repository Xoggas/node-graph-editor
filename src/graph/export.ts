import type { GraphModel } from "./graph";
import { localizationKey } from "./localization";
import type { NodeModel } from "./node";
import { type FieldSchema, isRecord, type NodeData } from "./schema";

export const RUNTIME_FORMAT = "node-graph-runtime";
export const RUNTIME_FORMAT_VERSION = 1;

export interface RuntimeNode {
  type: string;
  data: NodeData;
  /** Port key → ids of the nodes connected to it; ports without connections are omitted. */
  inputs?: Record<string, string[]>;
  outputs?: Record<string, string[]>;
}

export interface RuntimeGraph {
  format: typeof RUNTIME_FORMAT;
  version: typeof RUNTIME_FORMAT_VERSION;
  graph: string;
  pack: string | null;
  /** The node execution starts from (the pack's `export.entry` schema), when present. */
  entry?: string;
  /** Per node type: the schema `meta` (e.g. whether the node blocks), written once instead of per node. */
  types: Record<string, Record<string, unknown>>;
  nodes: Record<string, RuntimeNode>;
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
      warnings.push(`'${label}' has no schema ('${node.schemaId}') and is exported as-is.`);
    } else if (Object.keys(node.schema.meta).length > 0) {
      types[node.schemaId] = node.schema.meta;
    }
    const runtime: RuntimeNode = { type: node.schemaId, data: node.schema ? exportData(graph, node, warnings) : node.data };
    const inputs = connectedPorts(graph, node, "Input");
    const outputs = connectedPorts(graph, node, "Output");
    if (inputs) runtime.inputs = inputs;
    if (outputs) runtime.outputs = outputs;
    nodes[node.id] = runtime;
  }

  const result: RuntimeGraph = { format: RUNTIME_FORMAT, version: RUNTIME_FORMAT_VERSION, graph: graph.id, pack: pack?.id ?? null, types, nodes };
  const entrySchema = pack?.exportEntry;
  if (entrySchema) {
    const entries = [...graph.nodes].filter((node) => node.schemaId === entrySchema);
    if (entries.length === 0) {
      warnings.push(`There is no '${pack.nodes.get(entrySchema)?.title ?? entrySchema}' node to start from.`);
    } else {
      result.entry = entries[0].id;
      if (entries.length > 1) warnings.push(`There are ${entries.length} start nodes; the first one is used.`);
    }
  }
  if (graph.unresolvedConnections.length > 0) {
    warnings.push(`${graph.unresolvedConnections.length} unresolved connection(s) are not exported.`);
  }
  return { graph: result, warnings };
}

function connectedPorts(graph: GraphModel, node: NodeModel, direction: "Input" | "Output"): Record<string, string[]> | undefined {
  const result: Record<string, string[]> = {};
  for (const port of node.ports) {
    if (port.direction !== direction) continue;
    const targets = [...graph.getPortConnections(port.id)].map((connection) =>
      direction === "Output" ? connection.inputNodeId : connection.outputNodeId,
    );
    if (targets.length > 0) result[port.key] = targets;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Node data with localized texts replaced by their keys and references checked. */
function exportData(graph: GraphModel, node: NodeModel, warnings: string[]): NodeData {
  const label = node.name || node.schema!.title;
  const visit = (field: FieldSchema, value: unknown, path: (string | number)[]): unknown => {
    switch (field.type) {
      case "localizedText": {
        const key = localizationKey(node, field, path, value);
        if (!key) warnings.push(`'${label}' → ${field.label}: no localization key (the node has no name).`);
        return key;
      }
      case "nodeRef":
        if (typeof value === "string" && !graph.getNode(value)) warnings.push(`'${label}' → ${field.label}: the referenced node was deleted.`);
        return value;
      case "itemRef":
        if (typeof value === "string" && !graph.findItem(value)) warnings.push(`'${label}' → ${field.label}: the referenced element was deleted.`);
        return value;
      case "resource":
        if (typeof value === "string" && !graph.registry.pack?.resources.items.has(value)) {
          warnings.push(`'${label}' → ${field.label}: resource '${value}' is not in the library.`);
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
