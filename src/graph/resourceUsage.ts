import type { GraphModel } from "./graph";
import { type FieldSchema, isRecord } from "./schema";

/** For each resource id, the ids of the nodes whose resource fields (also in lists and records) choose it. */
export function resourceUsage(graph: GraphModel): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const used = new Set<string>();
    const visit = (field: FieldSchema, value: unknown): void => {
      if (field.type === "resource") {
        if (typeof value === "string" && value) used.add(value);
      } else if (field.type === "list") {
        if (Array.isArray(value)) for (const item of value) visit(field.item, item);
      } else if (field.type === "record") {
        if (isRecord(value)) for (const child of field.fields) visit(child, value[child.id]);
      }
    };
    for (const field of node.schema?.fields ?? []) visit(field, node.data[field.id]);
    for (const id of used) {
      let nodes = usage.get(id);
      if (!nodes) usage.set(id, (nodes = []));
      nodes.push(node.id);
    }
  }
  return usage;
}
