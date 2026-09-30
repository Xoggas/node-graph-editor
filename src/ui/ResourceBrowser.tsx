import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "../app/editor";
import { fileName } from "../app/files";
import { type ResourceItem, type ResourceLibrary, type ResourceTypeSchema, resourcesOfType } from "../graph/resources";
import { resourceUsage } from "../graph/resourceUsage";
import { t } from "../i18n";

interface ResourceBrowserProps {
  editor: Editor;
  library: ResourceLibrary;
  type: ResourceTypeSchema;
  /** Language of the texts shown for properties that are localization keys. */
  language: string | null;
  /** The language switch, shown next to the filter. */
  languageSelect: ReactNode;
  /** Bumped to focus the filter (Ctrl+F on this tab). */
  focusRequest: number;
  /** Shows the nodes that use a resource on the graph tab. */
  onShowUses: (nodeIds: string[]) => void;
}

/** Longest side of the cached previews (px). */
const THUMBNAIL_SIZE = 192;

/** A list of the library's resources of one type: previews, variants, files, properties and uses. */
export function ResourceBrowser({ editor, library, type, language, languageSelect, focusRequest, onShowUses }: ResourceBrowserProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const audio = useAudio(editor);

  useEffect(() => {
    if (focusRequest > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusRequest]);
  useEffect(() => setQuery(""), [type.id]);
  useEffect(() => audio.stop, [type.id, audio.stop]);

  const translate = (value: unknown) =>
    typeof value === "string" && value && language ? editor.localization.get(language, value) : undefined;

  const items = useMemo(() => resourcesOfType(library, type.id), [library, type.id]);
  // Recomputed on every render (the app re-renders on graph changes); a walk over node data is cheap.
  const usage = resourceUsage(editor.graph);
  const needle = normalize(query.trim());
  const shown = needle ? items.filter((item) => searchText(item, translate).includes(needle)) : items;

  const hasFiles = items.some((item) => item.file || item.image);
  const hasProperties = items.some((item) => Object.keys(item.properties).length > 0);
  const collections = [...type.variants];
  // Data types (and image types whose items have no pictures, e.g. diary entries) get no preview column.
  const preview = type.media === "audio" ? "audio" : type.media === "image" && items.some((item) => item.image) ? "image" : null;

  return (
    <div className="resource-browser">
      <div className="resource-header">
        <h2>{type.label}</h2>
        <span className="resource-count">
          {needle ? t("{shown} of {count} item(s)", { shown: shown.length, count: items.length }) : t("{count} item(s)", { count: items.length })}
        </span>
        <input
          ref={inputRef}
          className="resource-filter"
          value={query}
          placeholder={t("Filter by name, id, property or text…")}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setQuery("");
            }
          }}
        />
        {languageSelect}
      </div>
      {items.length === 0 ? (
        <div className="resource-empty">{t("The library has no {type}.", { type: type.label.toLowerCase() })}</div>
      ) : shown.length === 0 ? (
        <div className="resource-empty">{t("Nothing matches “{query}”.", { query: query.trim() })}</div>
      ) : (
        <div className="resource-list">
          <table>
            <thead>
              <tr>
                {preview && <th className="resource-col-preview" />}
                <th className="resource-col-name">{t("Name")}</th>
                {collections.map(([id, collection]) => (
                  <th key={id}>{collection.label}</th>
                ))}
                {hasFiles && <th>{t("File")}</th>}
                {hasProperties && <th>{t("Properties")}</th>}
                <th className="resource-col-uses">{t("Used")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((item) => {
                const uses = usage.get(item.id) ?? [];
                const path = item.file ?? item.image;
                return (
                  <tr key={item.id}>
                    {preview === "image" && (
                      <td className="resource-col-preview">
                        <Thumbnail editor={editor} library={library} path={item.image} size="large" />
                      </td>
                    )}
                    {preview === "audio" && (
                      <td className="resource-col-preview">
                        <button
                          className={`resource-play${audio.playing === item.id ? " playing" : ""}`}
                          disabled={!item.file}
                          title={item.file ? (audio.playing === item.id ? t("Stop") : t("Play")) : t("No file")}
                          onClick={() => item.file && audio.toggle(item.id, item.file)}
                        >
                          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                            {audio.playing === item.id ? (
                              <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor" />
                            ) : (
                              // Shifted right: a triangle looks centered when its mass is.
                              <path d="M3.5 1.5v9l7-4.5z" fill="currentColor" />
                            )}
                          </svg>
                        </button>
                      </td>
                    )}
                    <td className="resource-col-name">
                      <div className="resource-name">{item.name}</div>
                      <button
                        className="resource-id"
                        title={t("Copy the id")}
                        onClick={() => {
                          void navigator.clipboard?.writeText(item.id);
                          editor.setStatus(t("Copied the id of '{name}'.", { name: item.name }));
                        }}
                      >
                        {item.id}
                      </button>
                    </td>
                    {collections.map(([id, collection]) => (
                      <td key={id}>
                        <div className="resource-variants">
                          {(item.variants.get(id) ?? []).map((variant) => (
                            <span
                              key={variant.id}
                              className={`resource-variant${variant.id === collection.default ? " default" : ""}${variant.image ? "" : " no-image"}`}
                              title={variant.id === collection.default ? t("{name} (default)", { name: variant.label }) : variant.label}
                            >
                              {variant.image && <Thumbnail editor={editor} library={library} path={variant.image} size="small" />}
                              {variant.label}
                            </span>
                          ))}
                        </div>
                      </td>
                    ))}
                    {hasFiles && (
                      <td className="resource-file" title={path ?? undefined}>
                        {path ? fileName(path) : <span className="resource-none">—</span>}
                      </td>
                    )}
                    {hasProperties && (
                      <td>
                        <dl className="resource-properties">
                          {Object.entries(item.properties).map(([key, value]) => {
                            const text = translate(value);
                            return (
                              <div key={key}>
                                <dt>{key}</dt>
                                <dd>
                                  {formatValue(value)}
                                  {text !== undefined && <span className="resource-translation">{text}</span>}
                                </dd>
                              </div>
                            );
                          })}
                        </dl>
                      </td>
                    )}
                    <td className="resource-col-uses">
                      {uses.length > 0 ? (
                        <button className="resource-uses" onClick={() => onShowUses(uses)} title={t("Select these nodes on the graph")}>
                          {t("{count} node(s)", { count: uses.length })}
                        </button>
                      ) : (
                        <span className="resource-none" title={t("No node of the graph uses it")}>
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

function Thumbnail({ editor, library, path, size }: { editor: Editor; library: ResourceLibrary; path: string | null; size: "large" | "small" }) {
  const [state, setState] = useState<{ path: string; url: string | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!path) return;
    let active = true;
    thumbnailUrl(editor, library, path).then(
      (url) => active && setState({ path, url, error: null }),
      (error: unknown) => active && setState({ path, url: null, error: String(error) }),
    );
    return () => {
      active = false;
    };
  }, [editor, library, path]);

  const className = `resource-thumbnail ${size}`;
  if (!path) return <span className={`${className} missing`} title={t("No image")} />;
  if (state?.path !== path) return <span className={`${className} loading`} />;
  if (!state.url) return <span className={`${className} missing`} title={state.error ?? undefined}>!</span>;
  return <img className={className} src={state.url} alt="" draggable={false} />;
}

// Previews are downscaled once and kept as object URLs until another library is loaded.
let cachedLibrary: ResourceLibrary | null = null;
const thumbnails = new Map<string, Promise<string>>();

function thumbnailUrl(editor: Editor, library: ResourceLibrary, path: string): Promise<string> {
  if (cachedLibrary !== library) {
    for (const url of thumbnails.values()) url.then(URL.revokeObjectURL, () => {});
    thumbnails.clear();
    cachedLibrary = library;
  }
  let url = thumbnails.get(path);
  if (!url) {
    url = editor.readResource(path).then(downscale).then(URL.createObjectURL);
    thumbnails.set(path, url);
  }
  return url;
}

async function downscale(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1) {
    bitmap.close();
    return blob;
  }
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  const context = canvas.getContext("2d")!;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/png" });
}

/** One shared player: starting a sound stops the previous one. */
function useAudio(editor: Editor) {
  const [playing, setPlaying] = useState<string | null>(null);
  const current = useRef<{ id: string; element: HTMLAudioElement | null; url: string | null } | null>(null);

  const api = useMemo(() => {
    const stop = () => {
      const sound = current.current;
      current.current = null;
      sound?.element?.pause();
      if (sound?.url) URL.revokeObjectURL(sound.url);
      setPlaying(null);
    };
    const toggle = (id: string, path: string) => {
      const wasPlaying = current.current?.id === id;
      stop();
      if (wasPlaying) return;
      const sound: { id: string; element: HTMLAudioElement | null; url: string | null } = { id, element: null, url: null };
      current.current = sound;
      setPlaying(id);
      editor
        .readResource(path)
        .then((blob) => {
          if (current.current !== sound) return;
          sound.url = URL.createObjectURL(blob);
          sound.element = new Audio(sound.url);
          sound.element.onended = () => current.current === sound && stop();
          return sound.element.play();
        })
        .catch((error: unknown) => {
          if (current.current === sound) stop();
          editor.setStatus(t("Could not play '{file}': {error}", { file: fileName(path), error: String(error) }), "error");
        });
    };
    return { stop, toggle };
  }, [editor]);

  return { playing, ...api };
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function searchText(item: ResourceItem, translate: (value: unknown) => string | undefined): string {
  const parts = [item.name, item.id];
  for (const list of item.variants.values()) for (const variant of list) parts.push(variant.label);
  for (const value of Object.values(item.properties)) parts.push(formatValue(value), translate(value) ?? "");
  return normalize(parts.join("\n"));
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}
