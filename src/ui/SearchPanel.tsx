import { useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "../app/editor";
import type { GraphChange } from "../graph/graph";
import { type SearchMatch, searchNodes } from "../graph/search";
import type { GraphRenderer } from "../render/GraphRenderer";
import { t } from "../i18n";

interface SearchPanelProps {
  editor: Editor;
  renderer: () => GraphRenderer | null;
  /** Changes on every Ctrl+F: refocus the field and select the query. */
  focusRequest: number;
  onClose: () => void;
}

const SNIPPET_BEFORE = 24;
const SNIPPET_AFTER = 60;

/**
 * Find nodes by name, type or contents. Arrows walk the results and show each node on the canvas,
 * Enter (or a click) goes to it and closes the panel, Esc closes.
 */
export function SearchPanel({ editor, renderer, focusRequest, onClose }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const revision = useGraphRevision(editor);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const results = useMemo(
    () =>
      searchNodes(editor.graph, query, {
        languages: editor.getSnapshot().languages,
        text: (language, key) => editor.localization.get(language, key),
      }),
    // `revision` re-runs the search after graph and text edits.
    [editor, query, revision],
  );
  const current = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [current, results]);

  const show = (index: number) => {
    const result = results[index];
    if (!result) return;
    setActive(index);
    renderer()?.focusView(result.node.id);
  };
  const go = (index: number) => {
    if (!results[index]) return;
    show(index);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step !== 0 && results.length > 0) {
      show((current + step + results.length) % results.length);
    } else if (event.key === "Enter") {
      go(current);
    } else if (event.key === "Escape") {
      onClose();
    } else {
      return;
    }
    // Keep the app keymap (Esc clears the selection, arrows move nodes) out of it.
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <div className="search-panel" onKeyDown={onKeyDown}>
      <div className="search-field">
        <input
          ref={inputRef}
          value={query}
          placeholder={t("Find nodes: name, type, text…")}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <span className="search-count">
          {query.trim() ? (results.length === 0 ? t("No results") : t("{count} result(s)", { count: results.length })) : ""}
        </span>
        <button className="search-close" onClick={onClose} title={t("Close (Esc)")} aria-label={t("Close")}>
          ×
        </button>
      </div>
      {results.length > 0 && (
        <div ref={listRef} className="search-results" role="listbox">
          {results.map((result, index) => {
            const { node, match } = result;
            const color = node.schema?.color;
            const title = node.schema?.title ?? node.schemaId;
            return (
              <div
                key={node.id}
                role="option"
                aria-selected={index === current}
                className={`search-result${index === current ? " active" : ""}`}
                style={{ borderLeftColor: color !== null && color !== undefined ? `#${color.toString(16).padStart(6, "0")}` : undefined }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => go(index)}
              >
                <div className="search-result-title">
                  <span className="search-result-name">
                    {match?.where === "Name" && node.displayName === match.text ? <Highlighted match={match} /> : node.displayName}
                  </span>
                  {node.displayName !== title && <span className="search-result-type">{title}</span>}
                </div>
                {match && match.where !== "Name" && <Snippet match={match} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Highlighted({ match }: { match: SearchMatch }) {
  const { text, start, length } = match;
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, start + length)}</mark>
      {text.slice(start + length)}
    </>
  );
}

function Snippet({ match }: { match: SearchMatch }) {
  const text = match.text.replace(/\s/g, " ");
  const from = Math.max(0, match.start - SNIPPET_BEFORE);
  const to = Math.min(text.length, match.start + match.length + SNIPPET_AFTER);
  return (
    <div className="search-result-snippet">
      <span className="search-result-where">{match.where === "Name" ? t("Name") : match.where}:</span> {from > 0 && "…"}
      {text.slice(from, match.start)}
      <mark>{text.slice(match.start, match.start + match.length)}</mark>
      {text.slice(match.start + match.length, to)}
      {to < text.length && "…"}
    </div>
  );
}

/** A number that changes (at most once per frame) when the graph or its texts change. */
function useGraphRevision(editor: Editor): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let frame = 0;
    const bump = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setRevision((value) => value + 1);
      });
    };
    // Moves and panning do not change what matches.
    const onChange = (change: GraphChange) => {
      if (change.kind !== "viewportChanged" && change.kind !== "nodeMoved" && change.kind !== "aliasMoved") bump();
    };
    let unsubscribeGraph = editor.graph.subscribe(onChange);
    const unsubscribeReplaced = editor.onGraphReplaced((graph) => {
      unsubscribeGraph();
      unsubscribeGraph = graph.subscribe(onChange);
      bump();
    });
    const unsubscribeTexts = editor.onLocalizationChanged(bump);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribeGraph();
      unsubscribeReplaced();
      unsubscribeTexts();
    };
  }, [editor]);
  return revision;
}
