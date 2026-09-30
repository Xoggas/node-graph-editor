import { ru } from "./ru";

/**
 * Interface texts. Code writes the English text (the key) with `{name}` placeholders:
 * `t("Deleted {count} element(s).", { count })`. Other languages map that key to a template or, for
 * plurals and word order, to a function of the parameters. Pack content (node types, fields, ports)
 * is not translated here: it comes from the pack.
 */
export type UiLanguage = "en" | "ru";
export type Params = Record<string, string | number>;
export type Translation = string | ((params: Params) => string);

export const UI_LANGUAGES: { id: UiLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ru", label: "Русский" },
];

const dictionaries: Record<UiLanguage, Record<string, Translation>> = { en: {}, ru };
const STORAGE_KEY = "node-graph-editor.uiLanguage";

let current: UiLanguage = initialLanguage();
const listeners = new Set<() => void>();

export function t(text: string, params: Params = {}): string {
  const entry = dictionaries[current][text];
  if (typeof entry === "function") return entry(params);
  return format(entry ?? text, params);
}

export function uiLanguage(): UiLanguage {
  return current;
}

export function setUiLanguage(language: UiLanguage): void {
  if (language === current) return;
  current = language;
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Only a convenience.
  }
  for (const listener of listeners) listener();
}

/** Called after every language switch; returns the unsubscribe function. */
export function onUiLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The keys a language translates, e.g. to check that none is missing. */
export function translatedKeys(language: UiLanguage): string[] {
  return Object.keys(dictionaries[language]);
}

function format(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

function initialLanguage(): UiLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "ru") return stored;
  } catch {
    // Storage may be unavailable.
  }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ru") ? "ru" : "en";
}
