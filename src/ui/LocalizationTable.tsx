import { useEffect, useReducer, useRef, useState } from "react";
import type { Editor } from "../app/editor";
import { localizationUsage } from "../graph/localization";
import { t } from "../i18n";

interface LocalizationTableProps {
  editor: Editor;
  languages: readonly string[];
  /** Bumped to focus the filter (Ctrl+F on this tab). */
  focusRequest: number;
  /** Shows the nodes that use a key on the graph tab. */
  onShowUses: (nodeIds: string[]) => void;
}

type Show = "all" | "missing" | "unused";

const SHOW_LABELS: Record<Show, string> = { all: "All", missing: "Missing text", unused: "Unused" };
/** Rows rendered at once; the rest follow when scrolled near the end. */
const PAGE = 200;
/** The chosen left and right languages, e.g. "ru|en". */
const COLUMNS_KEY = "node-graph-editor.localizationColumns";

/**
 * Two localization tables side by side (left and right language are chosen in the column headers):
 * one row per key. Texts are edited in place (undoable, saved with Save); keys the graph uses link to
 * their nodes.
 */
export function LocalizationTable({ editor, languages, focusRequest, onShowUses }: LocalizationTableProps) {
  const [columns, setColumns] = useState<[string, string]>(() => initialColumns());
  // Fall back to the pack's first languages when a remembered one is not in this pack.
  const left = languages.includes(columns[0]) ? columns[0] : languages[0];
  const right = languages.includes(columns[1]) ? columns[1] : (languages.find((language) => language !== left) ?? left);
  const shown = left === right ? [left] : [left, right];
  const choose = (next: [string, string]) => {
    setColumns(next);
    try {
      localStorage.setItem(COLUMNS_KEY, next.join("|"));
    } catch {
      // Only a convenience.
    }
  };
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [limit, setLimit] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Texts live in the editor's store; re-render when they change.
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => editor.onLocalizationChanged(refresh), [editor]);

  useEffect(() => {
    if (focusRequest > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusRequest]);
  useEffect(() => {
    setLimit(PAGE);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, show]);

  const store = editor.localization;
  const usage = localizationUsage(editor.graph.nodes);
  const keys = [...new Set([...store.keys(), ...usage.keys()])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const missing = (key: string) => shown.some((language) => !store.get(language, key)?.trim());

  const needle = normalize(query.trim());
  const rows = keys.filter((key) => {
    if (show === "missing" && !missing(key)) return false;
    if (show === "unused" && usage.has(key)) return false;
    return !needle || normalize(key).includes(needle) || shown.some((language) => normalize(store.get(language, key) ?? "").includes(needle));
  });
  const counts = { all: keys.length, missing: keys.filter(missing).length, unused: keys.filter((key) => !usage.has(key)).length };

  return (
    <div className="resource-browser localization-table">
      <div className="resource-header">
        <h2>{t("Localization")}</h2>
        <span className="resource-count">
          {rows.length === keys.length ? t("{count} key(s)", { count: keys.length }) : t("{shown} of {count} key(s)", { shown: rows.length, count: keys.length })}
        </span>
        <div className="localization-show" role="radiogroup">
          {(Object.keys(SHOW_LABELS) as Show[]).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={show === option}
              className={show === option ? "active" : ""}
              onClick={() => setShow(option)}
            >
              {t(SHOW_LABELS[option])}
              <span className="tab-count">{counts[option]}</span>
            </button>
          ))}
        </div>
        <input
          ref={inputRef}
          className="resource-filter"
          value={query}
          placeholder={t("Filter by key or text…")}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
      </div>
      {languages.length === 0 ? (
        <div className="resource-empty">{t("The schema pack has no languages.")}</div>
      ) : rows.length === 0 ? (
        <div className="resource-empty">{keys.length === 0 ? t("There are no texts yet.") : t("Nothing matches.")}</div>
      ) : (
        <div
          ref={listRef}
          className="resource-list"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (limit < rows.length && list.scrollTop + list.clientHeight > list.scrollHeight - 600) setLimit(limit + PAGE);
          }}
        >
          <table>
            <thead>
              <tr>
                <th className="localization-col-key">{t("Key")}</th>
                <th>
                  <div className="localization-column">
                    <LanguagePicker languages={languages} value={left} onChange={(language) => choose(language === right ? [right, left] : [language, right])} />
                    {languages.length > 1 && (
                      <button className="localization-swap" title={t("Swap the languages")} onClick={() => choose([right, left])}>
                        ⇄
                      </button>
                    )}
                  </div>
                </th>
                {left !== right && (
                  <th>
                    <LanguagePicker languages={languages} value={right} onChange={(language) => choose(language === left ? [right, left] : [left, language])} />
                  </th>
                )}
                <th className="resource-col-uses">{t("Used")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((key) => {
                const uses = usage.get(key) ?? [];
                return (
                  <tr key={key}>
                    <td className="localization-col-key">
                      <span className="localization-key">{key}</span>
                    </td>
                    {shown.map((language) => (
                      <td key={language} className="localization-cell">
                        <TextCell
                          value={store.get(language, key)}
                          language={language}
                          onCommit={(text) => editor.setTexts(key, { [language]: text })}
                        />
                      </td>
                    ))}
                    <td className="resource-col-uses">
                      {uses.length > 0 ? (
                        <button className="resource-uses" onClick={() => onShowUses(uses)} title={t("Select these nodes on the graph")}>
                          {t("{count} node(s)", { count: uses.length })}
                        </button>
                      ) : (
                        <span className="resource-none" title={t("No node of the graph uses this key")}>
                          {t("unused")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LanguagePicker({ languages, value, onChange }: { languages: readonly string[]; value: string; onChange: (language: string) => void }) {
  return (
    <select className="localization-language" value={value} onChange={(event) => onChange(event.target.value)} title={t("Language of this column")}>
      {languages.map((language) => (
        <option key={language} value={language}>
          {language.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

function initialColumns(): [string, string] {
  try {
    const [left = "", right = ""] = (localStorage.getItem(COLUMNS_KEY) ?? "").split("|");
    return [left, right];
  } catch {
    return ["", ""];
  }
}

/** A text shown as-is; a click turns it into a text area (Ctrl+Enter or leaving it saves, Esc cancels). */
function TextCell({ value, language, onCommit }: { value: string | undefined; language: string; onCommit: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    const area = areaRef.current;
    if (!editing || !area) return;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    fit(area);
  }, [editing]);

  if (editing) {
    return (
      <textarea
        ref={areaRef}
        className="localization-editor"
        defaultValue={value ?? ""}
        lang={language}
        spellCheck
        onInput={(event) => fit(event.currentTarget)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            cancelled.current = true;
            event.currentTarget.blur();
          } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const text = event.currentTarget.value;
          if (!cancelled.current && text !== (value ?? "")) onCommit(text);
          cancelled.current = false;
          setEditing(false);
        }}
      />
    );
  }
  const empty = !value?.trim();
  return (
    <button className={`localization-text${empty ? " missing" : ""}`} onClick={() => setEditing(true)} title={t("Click to edit")}>
      {empty ? t("missing") : value}
    </button>
  );
}

function fit(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}
