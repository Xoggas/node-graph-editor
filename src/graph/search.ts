import type { GraphModel } from "./graph";
import { localizationKey } from "./localization";
import type { NodeModel } from "./node";
import { type FieldSchema, isRecord } from "./schema";

export interface SearchMatch {
  /** Where the text was found, e.g. "Name", "Line · EN", "Character". */
  where: string;
  text: string;
  /** Position of the query inside `text`. */
  start: number;
  length: number;
}

export interface SearchResult {
  node: NodeModel;
  /** Null when only the node type matched. */
  match: SearchMatch | null;
}

export interface SearchSources {
  languages: readonly string[];
  text(language: string, key: string): string | undefined;
}

const MAX_RESULTS = 200;

/**
 * Finds nodes whose name, type or contents (texts in every language, strings, chosen resources and
 * options) contain the query, case-insensitively. Name matches come first, then type, then contents.
 */
export function searchNodes(graph: GraphModel, query: string, sources: SearchSources): SearchResult[] {
  const needle = normalize(query.trim());
  if (!needle) {
    return [];
  }
  const ranked: { result: SearchResult; rank: number }[] = [];
  for (const node of graph.nodes) {
    const found = matchNode(graph, node, needle, sources);
    if (found) ranked.push(found);
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.slice(0, MAX_RESULTS).map(({ result }) => result);
}

function matchNode(graph: GraphModel, node: NodeModel, needle: string, sources: SearchSources): { result: SearchResult; rank: number } | null {
  const name = node.name.trim();
  if (name) {
    const index = normalize(name).indexOf(needle);
    if (index >= 0) {
      const rank = index === 0 ? (name.length === needle.length ? 0 : 1) : 2;
      return { result: { node, match: { where: "Name", text: name, start: index, length: needle.length } }, rank };
    }
  }
  const title = node.schema?.title ?? node.schemaId;
  if (normalize(title).includes(needle)) {
    return { result: { node, match: null }, rank: 3 };
  }
  const match = matchContents(graph, node, needle, sources);
  return match ? { result: { node, match }, rank: 4 } : null;
}

function matchContents(graph: GraphModel, node: NodeModel, needle: string, sources: SearchSources): SearchMatch | null {
  const resources = graph.registry.pack?.resources;
  const check = (where: string, text: string | undefined | null): SearchMatch | null => {
    if (!text) return null;
    const index = normalize(text).indexOf(needle);
    return index >= 0 ? { where, text, start: index, length: needle.length } : null;
  };

  const visit = (field: FieldSchema, value: unknown, path: (string | number)[], where: string): SearchMatch | null => {
    switch (field.type) {
      case "string":
        return check(where, typeof value === "string" ? value : null);
      case "localizedText": {
        const key = localizationKey(node, field, path, value);
        if (!key) return null;
        for (const language of sources.languages) {
          const found = check(`${where} · ${language.toUpperCase()}`, sources.text(language, key));
          if (found) return found;
        }
        return null;
      }
      case "enum":
        return check(where, field.options.find((option) => option.value === value)?.label);
      case "resource":
        return check(where, typeof value === "string" ? resources?.items.get(value)?.name : null);
      case "resourceVariant": {
        const source = node.data[field.source];
        const item = typeof source === "string" ? resources?.items.get(source) : undefined;
        return check(where, item?.variants.get(field.collection)?.find((variant) => variant.id === value)?.label);
      }
      case "list":
        if (!Array.isArray(value)) return null;
        for (let index = 0; index < value.length; index++) {
          const found = visit(field.item, value[index], [...path, index], `${where} ${index + 1}`);
          if (found) return found;
        }
        return null;
      case "record":
        if (!isRecord(value)) return null;
        for (const child of field.fields) {
          const found = visit(child, value[child.id], [...path, child.id], `${where} → ${child.label}`);
          if (found) return found;
        }
        return null;
      default:
        return null;
    }
  };

  for (const field of node.schema?.fields ?? []) {
    const found = visit(field, node.data[field.id], [field.id], field.label);
    if (found) return found;
  }
  return null;
}

/** Case- and ё-insensitive form of a text; keeps its length so match positions stay valid. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}
