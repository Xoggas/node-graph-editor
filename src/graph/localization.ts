import type { DataPath } from "./dataOps";
import { t } from "../i18n";
import { formatLabel, isRecord, type LocalizedTextField, type NodeData, type NodeSchema } from "./schema";

export interface LocalizationChange {
  language: string;
  key: string;
  previous: string | undefined;
  next: string | undefined;
}

export type LocalizationListener = (change: LocalizationChange) => void;

/** Folder of the per-language files inside a pack. */
export const LOCALIZATION_DIR = "localization";

/**
 * Texts of all languages, one flat `{ key: text }` table per language. Changes are emitted so the
 * history can undo them and views can refresh; `dirtyLanguages` tracks what needs saving.
 */
export class LocalizationStore {
  private readonly tables = new Map<string, Map<string, string>>();
  private readonly listeners = new Set<LocalizationListener>();
  readonly dirtyLanguages = new Set<string>();

  constructor(readonly languages: readonly string[]) {
    for (const language of languages) {
      this.tables.set(language, new Map());
    }
  }

  /** Reads `localization/<language>.json` files; unknown languages are ignored with a warning. */
  static fromFiles(languages: readonly string[], files: { path: string; text: string }[], warnings: string[]): LocalizationStore {
    const store = new LocalizationStore(languages);
    for (const file of files) {
      const match = new RegExp(`^${LOCALIZATION_DIR}/([^/]+)\\.json$`).exec(file.path);
      if (!match) continue;
      const language = match[1];
      const table = store.tables.get(language);
      if (!table) {
        warnings.push(t("{file}: language '{language}' is not listed in pack.json.", { file: file.path, language }));
        continue;
      }
      let json: unknown;
      try {
        json = JSON.parse(file.text);
      } catch (error) {
        warnings.push(t("{file}: invalid JSON ({error}).", { file: file.path, error: (error as Error).message }));
        continue;
      }
      if (!isRecord(json)) {
        warnings.push(t("{file}: expected { \"key\": \"text\" }.", { file: file.path }));
        continue;
      }
      for (const [key, text] of Object.entries(json)) {
        if (typeof text === "string") table.set(key, text);
      }
    }
    return store;
  }

  get isDirty(): boolean {
    return this.dirtyLanguages.size > 0;
  }

  subscribe(listener: LocalizationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(language: string, key: string): string | undefined {
    return this.tables.get(language)?.get(key);
  }

  /** Every key that has a text in any language. */
  keys(): Set<string> {
    const keys = new Set<string>();
    for (const table of this.tables.values()) for (const key of table.keys()) keys.add(key);
    return keys;
  }

  hasKey(key: string): boolean {
    return [...this.tables.values()].some((table) => table.has(key));
  }

  /** Sets a text; `undefined` removes the key from that language. */
  set(language: string, key: string, text: string | undefined): void {
    const table = this.tables.get(language);
    if (!table) return;
    const previous = table.get(key);
    if (previous === text) return;
    if (text === undefined) table.delete(key);
    else table.set(key, text);
    this.dirtyLanguages.add(language);
    for (const listener of this.listeners) {
      listener({ language, key, previous, next: text });
    }
  }

  /** Moves every language's text from one key to another (used when a node is renamed). */
  move(from: string, to: string): void {
    if (from === to) return;
    for (const language of this.languages) {
      const text = this.get(language, from);
      if (text === undefined || this.get(language, to) !== undefined) continue;
      this.set(language, to, text);
      this.set(language, from, undefined);
    }
  }

  /** Copies every language's text to a new key (used when a node is duplicated). */
  copy(from: string, to: string): void {
    for (const language of this.languages) {
      const text = this.get(language, from);
      if (text !== undefined && this.get(language, to) === undefined) {
        this.set(language, to, text);
      }
    }
  }

  /** File contents for a language, keys sorted for stable diffs. */
  serialize(language: string): string {
    const table = this.tables.get(language) ?? new Map<string, string>();
    const sorted = Object.fromEntries([...table.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
    return `${JSON.stringify(sorted, null, 2)}\n`;
  }

  markSaved(language: string): void {
    this.dirtyLanguages.delete(language);
  }
}

/**
 * Localization key of a localized text field: an explicit key stored in the data, or — for
 * `keyFrom: "name"` — the node name plus the field's suffix (`{n}` is the list position).
 * Null when there is no key yet (e.g. the node has no name).
 */
export function localizationKey(node: { name: string }, field: LocalizedTextField, path: DataPath, value: unknown): string | null {
  if (typeof value === "string" && value) {
    return value;
  }
  if (field.keyFrom !== "name" || !node.name.trim()) {
    return null;
  }
  const index = [...path].reverse().find((segment): segment is number => typeof segment === "number");
  return `${node.name.trim()}${field.keySuffix ? formatLabel(field.keySuffix, index ?? 0, null) : ""}`;
}

export interface LocalizedEntry {
  field: LocalizedTextField;
  path: DataPath;
  key: string | null;
}

/** Every localized text of a node (top-level fields and fields of records in lists), with its key. */
export function localizedEntries(node: { name: string; schema: NodeSchema | null; data: NodeData }): LocalizedEntry[] {
  const entries: LocalizedEntry[] = [];
  for (const field of node.schema?.fields ?? []) {
    if (field.type === "localizedText") {
      entries.push({ field, path: [field.id], key: localizationKey(node, field, [field.id], node.data[field.id]) });
    } else if (field.type === "list" && field.item.type === "record" && Array.isArray(node.data[field.id])) {
      (node.data[field.id] as unknown[]).forEach((item, index) => {
        if (field.item.type !== "record" || !isRecord(item)) return;
        for (const child of field.item.fields) {
          if (child.type !== "localizedText") continue;
          const path = [field.id, index, child.id];
          entries.push({ field: child, path, key: localizationKey(node, child, path, item[child.id]) });
        }
      });
    }
  }
  return entries;
}

/** For each localization key the graph uses, the ids of the nodes whose texts use it. */
export function localizationUsage(nodes: Iterable<{ id: string; name: string; schema: NodeSchema | null; data: NodeData }>): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const node of nodes) {
    for (const { key } of localizedEntries(node)) {
      if (!key) continue;
      const ids = usage.get(key);
      if (!ids) usage.set(key, [node.id]);
      else if (!ids.includes(node.id)) ids.push(node.id);
    }
  }
  return usage;
}
