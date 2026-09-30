import type { GraphModel } from "./graph";
import {
  defaultValue,
  type FieldSchema,
  formatLabel,
  isRecord,
  type ItemRefField,
  type NodeData,
  type NodeRefField,
  type NodeSchema,
} from "./schema";

/** Path into node data: a top-level field id, then list indices and record field ids. */
export type DataPath = readonly (string | number)[];

export function getIn(data: unknown, path: DataPath): unknown {
  let current = data;
  for (const key of path) {
    if (typeof key === "number" ? !Array.isArray(current) : !isRecord(current)) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** Returns a copy of `data` with `value` at `path`; untouched branches are shared. */
export function setIn(data: NodeData, path: DataPath, value: unknown): NodeData {
  const update = (current: unknown, depth: number): unknown => {
    if (depth === path.length) {
      return value;
    }
    const key = path[depth];
    if (typeof key === "number") {
      const list = Array.isArray(current) ? [...current] : [];
      list[key] = update(list[key], depth + 1);
      return list;
    }
    const record = isRecord(current) ? { ...current } : {};
    record[key] = update(record[key], depth + 1);
    return record;
  };
  return update(data, 0) as NodeData;
}

/** Schema of the value at `path`, descending through lists and records. */
export function fieldAt(schema: NodeSchema, path: DataPath): FieldSchema | undefined {
  let field = schema.fields.find((candidate) => candidate.id === path[0]);
  for (const key of path.slice(1)) {
    if (!field) return undefined;
    if (typeof key === "number") {
      field = field.type === "list" ? field.item : undefined;
    } else {
      field = field.type === "record" ? field.fields.find((candidate) => candidate.id === key) : undefined;
    }
  }
  return field;
}

export function listAdd(schema: NodeSchema, data: NodeData, path: DataPath): NodeData | null {
  const field = fieldAt(schema, path);
  const list = getIn(data, path);
  if (field?.type !== "list" || !Array.isArray(list) || (field.maxItems !== undefined && list.length >= field.maxItems)) {
    return null;
  }
  return setIn(data, path, [...list, defaultValue(field.item)]);
}

export function listRemove(schema: NodeSchema, data: NodeData, path: DataPath, index: number): NodeData | null {
  const field = fieldAt(schema, path);
  const list = getIn(data, path);
  if (field?.type !== "list" || !Array.isArray(list) || index < 0 || index >= list.length || list.length <= field.minItems) {
    return null;
  }
  return setIn(data, path, list.filter((_, itemIndex) => itemIndex !== index));
}

export function listMove(data: NodeData, path: DataPath, index: number, delta: number): NodeData | null {
  const list = getIn(data, path);
  const target = index + delta;
  if (!Array.isArray(list) || index < 0 || index >= list.length || target < 0 || target >= list.length) {
    return null;
  }
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return setIn(data, path, next);
}

/** "1.1 → Choice 2" for a referenced list element, or null when it no longer exists. */
export function itemRefLabel(graph: GraphModel, itemId: string): string | null {
  const location = graph.findItem(itemId);
  if (!location) {
    return null;
  }
  const list = location.node.schema?.fields.find((field) => field.id === location.listFieldId);
  const itemLabel = list?.type === "list" ? formatLabel(list.itemLabel, location.index, location.item) : `#${location.index + 1}`;
  return `${location.node.displayName} → ${itemLabel}`;
}

/** Every element an `itemRef` field can point to, in graph order. */
export function itemRefCandidates(graph: GraphModel, field: ItemRefField): { value: string; label: string }[] {
  const result: { value: string; label: string }[] = [];
  for (const node of graph.nodes) {
    if (node.schemaId !== field.schema) continue;
    const list = node.data[field.list];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isRecord(item) && typeof item.id === "string") {
        result.push({ value: item.id, label: itemRefLabel(graph, item.id) ?? item.id });
      }
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Every node a `nodeRef` field can point to, by display name. */
export function nodeRefCandidates(graph: GraphModel, field: NodeRefField): { value: string; label: string }[] {
  return [...graph.nodes]
    .filter((node) => node.schemaId === field.schema)
    .map((node) => ({ value: node.id, label: node.displayName }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}
