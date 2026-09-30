import { uiLanguage } from "../i18n";

/**
 * A display text of a schema pack (a node title, a field label, a menu…): one string for every
 * language, or one per interface language, e.g. `{ "en": "Line", "ru": "Реплика" }`. Languages
 * missing from the object fall back to English, then to the first one given.
 */
export type TextSource = string | Readonly<Record<string, string>>;

/** A text source from JSON, or undefined when the value is neither a string nor an object of strings. */
export function readText(value: unknown): TextSource | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** The text in the current interface language. */
export function pickText(source: TextSource): string {
  if (typeof source === "string") return source;
  return source[uiLanguage()] ?? source.en ?? Object.values(source)[0] ?? "";
}

/**
 * Sets `object[key]` to the text in the interface language, following later language switches: code
 * reads `schema.title` as a plain string and gets the current translation.
 */
export function localize<T extends object>(object: T, key: keyof T & string, source: TextSource | undefined): void {
  if (source === undefined) return;
  if (typeof source === "string") {
    (object as Record<string, unknown>)[key] = source;
    return;
  }
  Object.defineProperty(object, key, { get: () => pickText(source), enumerable: true, configurable: true });
}
