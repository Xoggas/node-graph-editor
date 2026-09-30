import { isRecord } from "./schema";

export interface VariantCollectionSchema {
  label: string;
  /** Variant id used when a resource does not have the previously selected one. */
  default: string | null;
}

export interface ResourceTypeSchema {
  id: string;
  label: string;
  /** "image" resources get previews on nodes; "audio" and "data" do not. */
  media: "image" | "audio" | "data";
  variants: Map<string, VariantCollectionSchema>;
}

export interface ResourceVariant {
  id: string;
  label: string;
  /** Absolute file path, or null when the variant has no image. */
  image: string | null;
}

export interface ResourceItem {
  id: string;
  type: string;
  name: string;
  /** Absolute file paths. */
  image: string | null;
  file: string | null;
  variants: Map<string, ResourceVariant[]>;
  properties: Record<string, unknown>;
}

export interface ResourceLibrary {
  types: Map<string, ResourceTypeSchema>;
  items: Map<string, ResourceItem>;
  /** Folders resource files may be read from (library roots). */
  roots: string[];
}

export function emptyLibrary(): ResourceLibrary {
  return { types: new Map(), items: new Map(), roots: [] };
}

export function parseResourceTypes(value: unknown, warnings: string[]): Map<string, ResourceTypeSchema> {
  const types = new Map<string, ResourceTypeSchema>();
  if (value === undefined) {
    return types;
  }
  if (!isRecord(value)) {
    warnings.push("pack.json → resourceTypes: expected an object.");
    return types;
  }
  for (const [id, raw] of Object.entries(value)) {
    const entry = isRecord(raw) ? raw : {};
    const variants = new Map<string, VariantCollectionSchema>();
    if (isRecord(entry.variants)) {
      for (const [collection, rawCollection] of Object.entries(entry.variants)) {
        const spec = isRecord(rawCollection) ? rawCollection : {};
        variants.set(collection, {
          label: typeof spec.label === "string" ? spec.label : collection,
          default: typeof spec.default === "string" ? spec.default : null,
        });
      }
    }
    const media = entry.media === "audio" || entry.media === "data" ? entry.media : "image";
    types.set(id, { id, label: typeof entry.label === "string" ? entry.label : id, media, variants });
  }
  return types;
}

/**
 * Parses library files (`resources/*.json` of a pack). Each file has an optional `root` — the folder
 * its `image`/`file` paths are relative to, itself relative to the library file (or absolute) — and
 * `items`. `packDir` is the absolute pack folder, or null when file paths cannot be resolved.
 */
export function parseLibraries(
  files: { path: string; text: string }[],
  types: Map<string, ResourceTypeSchema>,
  packDir: string | null,
  warnings: string[],
): ResourceLibrary {
  const library: ResourceLibrary = { types, items: new Map(), roots: [] };
  for (const file of files) {
    let json: unknown;
    try {
      json = JSON.parse(file.text);
    } catch (error) {
      warnings.push(`${file.path}: invalid JSON (${(error as Error).message}).`);
      continue;
    }
    if (!isRecord(json) || !Array.isArray(json.items)) {
      warnings.push(`${file.path}: expected { "items": [...] }.`);
      continue;
    }
    const fileDir = dirname(file.path);
    const rootSpec = typeof json.root === "string" ? json.root : ".";
    const root = packDir === null ? null : isAbsolute(rootSpec) ? normalizePath(rootSpec) : joinPath(packDir, fileDir, rootSpec);
    if (root && !library.roots.includes(root)) {
      library.roots.push(root);
    }
    const resolve = (value: unknown) => (typeof value === "string" && value && root ? joinPath(root, value) : null);

    json.items.forEach((raw, index) => {
      const location = `${file.path} → items[${index}]`;
      if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id || typeof raw.type !== "string") {
        warnings.push(`${location}: an item needs a string 'id' and 'type'.`);
        return;
      }
      if (!types.has(raw.type)) {
        warnings.push(`${location}: unknown resource type '${raw.type}'.`);
        return;
      }
      if (library.items.has(raw.id)) {
        warnings.push(`${location}: duplicate resource id '${raw.id}'.`);
        return;
      }
      const variants = new Map<string, ResourceVariant[]>();
      if (isRecord(raw.variants)) {
        for (const [collection, list] of Object.entries(raw.variants)) {
          if (!Array.isArray(list)) continue;
          variants.set(
            collection,
            list.filter(isRecord).flatMap((variant) =>
              typeof variant.id === "string"
                ? [{ id: variant.id, label: typeof variant.label === "string" ? variant.label : variant.id, image: resolve(variant.image) }]
                : [],
            ),
          );
        }
      }
      library.items.set(raw.id, {
        id: raw.id,
        type: raw.type,
        name: typeof raw.name === "string" && raw.name ? raw.name : raw.id,
        image: resolve(raw.image),
        file: resolve(raw.file),
        variants,
        properties: isRecord(raw.properties) ? raw.properties : {},
      });
    });
  }
  return library;
}

export function resourcesOfType(library: ResourceLibrary, type: string): ResourceItem[] {
  return [...library.items.values()]
    .filter((item) => item.type === type)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** The variant to fall back to when `current` is not available on `item`. */
export function defaultVariant(library: ResourceLibrary, item: ResourceItem, collection: string): string | null {
  const variants = item.variants.get(collection) ?? [];
  const preferred = library.types.get(item.type)?.variants.get(collection)?.default;
  if (preferred && variants.some((variant) => variant.id === preferred)) {
    return preferred;
  }
  return variants[0]?.id ?? null;
}

// --- Path helpers (Windows and POSIX) -----------------------------------------------------------

export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function dirname(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0 ? "." : path.slice(0, index);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((part) => part && part !== ".").join("/"));
}

/** Resolves `.` and `..` segments and uses forward slashes. */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, "/");
  const drive = /^[A-Za-z]:\//.test(unified) ? unified.slice(0, 2) : "";
  const absolute = drive !== "" || unified.startsWith("/");
  const segments: string[] = [];
  for (const segment of unified.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") segments.pop();
      else if (!absolute) segments.push("..");
    } else {
      segments.push(segment);
    }
  }
  const body = segments.join("/");
  return drive ? `${drive}/${body}` : absolute ? `/${body}` : body || ".";
}
