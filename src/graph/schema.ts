import { parseLibraries, parseResourceTypes, type ResourceLibrary } from "./resources";
import { newId, type PortCapacity, type PortDirection } from "./types";

// ---------------------------------------------------------------------------------------------
// Schema model
// ---------------------------------------------------------------------------------------------

export interface PortTypeSchema {
  id: string;
  label: string;
  color: number | null;
  /** Types this type can be connected to (in addition to itself). */
  extends: string[];
  /** Default capacity per direction for ports of this type. */
  capacity: { input?: PortCapacity; output?: PortCapacity };
}

export type PortRepeat = { list: string; label?: string } | { count: string; label?: string };

export interface PortSchema {
  id: string;
  direction: PortDirection;
  type: string;
  label?: string;
  capacity?: PortCapacity;
  /** One port per list element (keyed by the element GUID) or per number in a count field. */
  repeat?: PortRepeat;
}

interface FieldBase {
  id: string;
  label: string;
}

export interface NumberField extends FieldBase {
  type: "int" | "float";
  default: number;
  min?: number;
  max?: number;
}

export interface StringField extends FieldBase {
  type: "string";
  default: string;
  multiline: boolean;
  placeholder?: string;
}

export interface BoolField extends FieldBase {
  type: "bool";
  default: boolean;
}

export interface EnumOption {
  value: string;
  label: string;
}

export interface EnumField extends FieldBase {
  type: "enum";
  options: EnumOption[];
  default: string;
  display: "dropdown" | "segmented";
}

export interface RecordField extends FieldBase {
  type: "record";
  fields: FieldSchema[];
}

export interface ListField extends FieldBase {
  type: "list";
  item: FieldSchema;
  minItems: number;
  maxItems?: number;
  /** Label of an element when other nodes reference it, e.g. "Choice {n}: {item.text}". */
  itemLabel: string;
}

/** Reference to an element of a list in another node (by the element GUID). */
export interface ItemRefField extends FieldBase {
  type: "itemRef";
  schema: string;
  list: string;
}

/**
 * Text in every pack language, stored in the localization files. The node data keeps an explicit key
 * or null; with `keyFrom: "name"` a null value means "the node name (+ keySuffix)".
 */
export interface LocalizedTextField extends FieldBase {
  type: "localizedText";
  keyFrom: "name" | "none";
  keySuffix: string;
  multiline: boolean;
}

/** Reference to an item of the pack's resource library (by the resource id). */
export interface ResourceField extends FieldBase {
  type: "resource";
  resourceType: string;
  /** Height of the image preview under the field; 0 hides it. */
  previewHeight: number;
}

/** One variant (e.g. an emotion) of the resource chosen in the `source` field. */
export interface ResourceVariantField extends FieldBase {
  type: "resourceVariant";
  source: string;
  collection: string;
}

/** Reference to another node of the given schema (by the node GUID). */
export interface NodeRefField extends FieldBase {
  type: "nodeRef";
  schema: string;
}

/** Bool grid whose rows and columns follow other fields (an int count or a list). */
export interface MatrixField extends FieldBase {
  type: "matrix";
  rows: string;
  columns: string;
  rowLabel: string;
  columnLabel: string;
}

/** `{ rowKey: { columnKey: value } }` — keys are element GUIDs (list dimensions) or indices (counts). */
export type MatrixValue = Record<string, Record<string, boolean>>;

/** A field type this editor version does not implement; its data is preserved untouched. */
export interface UnsupportedField extends FieldBase {
  type: "unsupported";
  declaredType: string;
}

export type FieldSchema =
  | NumberField
  | StringField
  | BoolField
  | EnumField
  | RecordField
  | ListField
  | ItemRefField
  | NodeRefField
  | ResourceField
  | ResourceVariantField
  | LocalizedTextField
  | MatrixField
  | UnsupportedField;

export interface NamingRules {
  /** The user can rename nodes of this schema. */
  editable: boolean;
  /** Names must be unique among nodes of schemas with `unique: true`. */
  unique: boolean;
  pattern?: RegExp;
  /** Name given to new nodes: "chapter.index" continues the "1.12"-style numbering of the graph. */
  auto: "chapter.index" | null;
}

export interface NodeSchema {
  id: string;
  version: number;
  title: string;
  menu: string;
  color: number | null;
  description?: string;
  naming: NamingRules;
  /** At most one node of this schema per graph. */
  singleton: boolean;
  /** Opaque data for the game; the editor only stores and exports it. */
  meta: Record<string, unknown>;
  ports: PortSchema[];
  fields: FieldSchema[];
  view?: string;
}

export interface SchemaPack {
  id: string;
  version: number;
  name: string;
  languages: string[];
  portTypes: Map<string, PortTypeSchema>;
  nodes: Map<string, NodeSchema>;
  resources: ResourceLibrary;
  /** Schema of the node runtime exports start from (`export.entry` in pack.json). */
  exportEntry: string | null;
  /** Problems that did not prevent loading (e.g. an invalid node schema that was skipped). */
  warnings: string[];
}

export interface PackFile {
  /** Path relative to the pack root, with forward slashes. */
  path: string;
  text: string;
}

export class SchemaError extends Error {}

const FIELD_TYPES = new Set([
  "int",
  "float",
  "string",
  "bool",
  "enum",
  "record",
  "list",
  "itemRef",
  "nodeRef",
  "resource",
  "resourceVariant",
  "localizedText",
  "matrix",
]);
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

/**
 * Builds a pack from `pack.json`, `nodes/**.json` (one schema or an array per file) and
 * `resources/**.json` (resource libraries). `packDir` is the absolute pack folder used to resolve
 * resource files; without it resources load but have no images.
 */
export function parseSchemaPack(files: PackFile[], packDir: string | null = null): SchemaPack {
  const manifestFile = files.find((file) => file.path === "pack.json");
  if (!manifestFile) {
    throw new SchemaError("pack.json is missing in the pack folder.");
  }
  const manifest = parseJson(manifestFile);
  const reader = new Reader("pack.json");
  const root = reader.object(manifest, "");
  const pack: SchemaPack = {
    id: reader.id(root, "id"),
    version: reader.int(root, "version", 1),
    name: reader.string(root, "name", "") || reader.id(root, "id"),
    languages: reader.stringArray(root, "languages", []),
    portTypes: new Map(),
    nodes: new Map(),
    resources: { types: new Map(), items: new Map(), roots: [] },
    exportEntry: null,
    warnings: [],
  };
  const exportSettings = reader.optionalObject(root, "export");
  pack.exportEntry = exportSettings ? reader.optionalString(exportSettings, "entry") ?? null : null;
  const resourceTypes = parseResourceTypes(root.resourceTypes, pack.warnings);

  const portTypes = reader.optionalObject(root, "portTypes") ?? {};
  for (const [id, raw] of Object.entries(portTypes)) {
    const type = reader.object(raw, `portTypes.${id}`);
    const capacity = reader.optionalObject(type, "capacity") ?? {};
    pack.portTypes.set(id, {
      id,
      label: reader.string(type, "label", id),
      color: reader.color(type, "color"),
      extends: reader.stringArray(type, "extends", []),
      capacity: {
        input: reader.optionalEnum(capacity, "input", CAPACITIES),
        output: reader.optionalEnum(capacity, "output", CAPACITIES),
      },
    });
  }
  for (const type of pack.portTypes.values()) {
    for (const parent of type.extends) {
      if (!pack.portTypes.has(parent)) {
        throw new SchemaError(`pack.json: port type '${type.id}' extends unknown type '${parent}'.`);
      }
    }
  }
  if (reader.errors.length > 0) {
    throw new SchemaError(reader.errors.join("\n"));
  }

  pack.resources = parseLibraries(
    files.filter((file) => file.path.startsWith("resources/") && file.path.endsWith(".json")),
    resourceTypes,
    packDir,
    pack.warnings,
  );

  for (const file of files) {
    if (!file.path.startsWith("nodes/") || !file.path.endsWith(".json")) {
      continue;
    }
    let json: unknown;
    try {
      json = parseJson(file);
    } catch (error) {
      pack.warnings.push((error as Error).message);
      continue;
    }
    const entries = Array.isArray(json) ? json : [json];
    entries.forEach((entry, index) => {
      const location = Array.isArray(json) ? `${file.path}[${index}]` : file.path;
      try {
        const schema = parseNodeSchema(entry, location, pack);
        if (pack.nodes.has(schema.id)) {
          pack.warnings.push(`${location}: node schema '${schema.id}' is defined twice; the second definition is ignored.`);
          return;
        }
        pack.nodes.set(schema.id, schema);
      } catch (error) {
        pack.warnings.push((error as Error).message);
      }
    });
  }
  if (pack.exportEntry && !pack.nodes.has(pack.exportEntry)) {
    pack.warnings.push(`pack.json → export.entry: node schema '${pack.exportEntry}' does not exist.`);
  }
  for (const schema of pack.nodes.values()) {
    for (const field of collectFields(schema.fields, "resource") as ResourceField[]) {
      if (!resourceTypes.has(field.resourceType)) {
        pack.warnings.push(`${schema.id} → ${field.id}: unknown resource type '${field.resourceType}'.`);
      }
    }
    for (const field of collectFields(schema.fields, "resourceVariant") as ResourceVariantField[]) {
      const source = schema.fields.find((candidate) => candidate.id === field.source);
      if (source?.type !== "resource") {
        pack.warnings.push(`${schema.id} → ${field.id}: 'source' must name a resource field of the same node.`);
      } else if (!resourceTypes.get(source.resourceType)?.variants.has(field.collection)) {
        pack.warnings.push(`${schema.id} → ${field.id}: resource type '${source.resourceType}' has no variants '${field.collection}'.`);
      }
    }
    for (const ref of collectFields(schema.fields, "nodeRef") as NodeRefField[]) {
      if (!pack.nodes.has(ref.schema)) {
        pack.warnings.push(`${schema.id} → ${ref.id}: referenced schema '${ref.schema}' does not exist.`);
      }
    }
    for (const ref of collectFields(schema.fields, "itemRef") as ItemRefField[]) {
      const target = pack.nodes.get(ref.schema);
      const list = target?.fields.find((field) => field.id === ref.list);
      if (!target) {
        pack.warnings.push(`${schema.id} → ${ref.id}: referenced schema '${ref.schema}' does not exist.`);
      } else if (list?.type !== "list" || list.item.type !== "record") {
        pack.warnings.push(`${schema.id} → ${ref.id}: '${ref.schema}.${ref.list}' must be a list of records.`);
      }
    }
  }
  return pack;
}

/** Fields of the given type, including those nested in lists and records. */
export function collectFields(fields: FieldSchema[], type: FieldSchema["type"]): FieldSchema[] {
  const result: FieldSchema[] = [];
  const visit = (field: FieldSchema) => {
    if (field.type === type) result.push(field);
    if (field.type === "list") visit(field.item);
    if (field.type === "record") field.fields.forEach(visit);
  };
  fields.forEach(visit);
  return result;
}

export function parseNodeSchema(json: unknown, location: string, pack: Pick<SchemaPack, "portTypes">): NodeSchema {
  const reader = new Reader(location);
  const root = reader.object(json, "");
  const id = reader.id(root, "id");
  const naming = reader.optionalObject(root, "naming") ?? {};
  const pattern = reader.string(naming, "pattern", "");
  let patternRegex: RegExp | undefined;
  if (pattern) {
    try {
      patternRegex = new RegExp(pattern, "u");
    } catch {
      reader.error("naming.pattern", "is not a valid regular expression");
    }
  }

  const fields = reader.array(root, "fields").map((raw, index) => parseField(reader, raw, `fields[${index}]`));
  checkUniqueIds(reader, fields, "fields");
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  fields.forEach((field, index) => {
    if (field.type !== "matrix") return;
    for (const dimension of ["rows", "columns"] as const) {
      const source = fieldById.get(field[dimension])?.type;
      if (source !== "int" && source !== "list") {
        reader.error(`fields[${index}].${dimension}`, `must name an int or list field, got '${field[dimension]}'`);
      }
    }
  });

  const ports = reader.array(root, "ports").map((raw, index) => {
    const path = `ports[${index}]`;
    const port = reader.object(raw, path);
    const type = reader.string(port, "type", "");
    if (!pack.portTypes.has(type)) {
      reader.error(`${path}.type`, `unknown port type '${type}'`);
    }
    const result: PortSchema = {
      id: reader.id(port, "id", path),
      direction: reader.enum(port, "direction", DIRECTIONS, path),
      type,
      label: reader.optionalString(port, "label"),
      capacity: reader.optionalEnum(port, "capacity", CAPACITIES, path),
    };
    const repeat = reader.optionalObject(port, "repeat", path);
    if (repeat) {
      const label = reader.optionalString(repeat, "label");
      const list = reader.optionalString(repeat, "list");
      const count = reader.optionalString(repeat, "count");
      if (list) {
        if (fieldById.get(list)?.type !== "list") {
          reader.error(`${path}.repeat.list`, `must name a list field, got '${list}'`);
        }
        result.repeat = { list, label };
      } else if (count) {
        const countField = fieldById.get(count);
        if (countField?.type !== "int") {
          reader.error(`${path}.repeat.count`, `must name an int field, got '${count}'`);
        }
        result.repeat = { count, label };
      } else {
        reader.error(`${path}.repeat`, "needs 'list' or 'count'");
      }
    }
    return result;
  });
  checkUniqueIds(reader, ports, "ports");

  const schema: NodeSchema = {
    id,
    version: reader.int(root, "version", 1),
    title: reader.string(root, "title", id),
    menu: reader.string(root, "menu", ""),
    color: reader.color(root, "color"),
    description: reader.optionalString(root, "description"),
    naming: {
      editable: reader.bool(naming, "editable", true),
      unique: reader.bool(naming, "unique", false),
      pattern: patternRegex,
      auto: naming.auto === undefined ? null : reader.enum(naming, "auto", ["chapter.index"] as const, "naming"),
    },
    singleton: reader.bool(root, "singleton", false),
    meta: reader.optionalObject(root, "meta") ?? {},
    ports,
    fields,
    view: reader.optionalString(root, "view"),
  };
  if (reader.errors.length > 0) {
    throw new SchemaError(reader.errors.join("\n"));
  }
  return schema;
}

function parseField(reader: Reader, raw: unknown, path: string, requireId = true): FieldSchema {
  const field = reader.object(raw, path);
  const id = requireId ? reader.id(field, "id", path) : reader.string(field, "id", "item");
  const type = reader.string(field, "type", "", path);
  const label = reader.string(field, "label", humanize(id));
  if (!FIELD_TYPES.has(type)) {
    return { id, label, type: "unsupported", declaredType: type || "(missing)" };
  }
  switch (type) {
    case "int":
    case "float": {
      const min = reader.optionalNumber(field, "min", path);
      const max = reader.optionalNumber(field, "max", path);
      const fallback = min !== undefined && min > 0 ? min : 0;
      const result: NumberField = { id, label, type, default: reader.number(field, "default", fallback, path), min, max };
      result.default = clampNumber(result, result.default);
      return result;
    }
    case "string":
      return {
        id,
        label,
        type,
        default: reader.string(field, "default", ""),
        multiline: reader.bool(field, "multiline", false),
        placeholder: reader.optionalString(field, "placeholder"),
      };
    case "bool":
      return { id, label, type, default: reader.bool(field, "default", false) };
    case "enum": {
      const options = reader.array(field, "options", path).map((option, index) => {
        if (typeof option === "string") {
          return { value: option, label: option };
        }
        const entry = reader.object(option, `${path}.options[${index}]`);
        const value = reader.string(entry, "value", "", `${path}.options[${index}]`);
        return { value, label: reader.string(entry, "label", value) };
      });
      if (options.length === 0) {
        reader.error(`${path}.options`, "must not be empty");
      }
      const fallback = options[0]?.value ?? "";
      const value = reader.string(field, "default", fallback);
      if (options.length > 0 && !options.some((option) => option.value === value)) {
        reader.error(`${path}.default`, `'${value}' is not one of the options`);
      }
      return { id, label, type, options, default: value, display: reader.enum(field, "display", ["dropdown", "segmented"], path, "dropdown") };
    }
    case "record": {
      const fields = reader.array(field, "fields", path).map((entry, index) => parseField(reader, entry, `${path}.fields[${index}]`));
      checkUniqueIds(reader, fields, `${path}.fields`);
      if (fields.some((entry) => entry.id === "id")) {
        reader.error(`${path}.fields`, "'id' is reserved for the element GUID");
      }
      return { id, label, type, fields };
    }
    case "list": {
      const item = parseField(reader, reader.object(field, "item", path), `${path}.item`, false);
      if (item.type === "list" || item.type === "matrix") {
        reader.error(`${path}.item`, `a list of '${item.type}' is not supported`);
      }
      if (item.type === "record" && item.fields.some((child) => child.type === "list" || child.type === "matrix")) {
        reader.error(`${path}.item`, "records inside lists cannot contain lists or matrices");
      }
      return {
        id,
        label,
        type,
        item,
        minItems: Math.max(0, reader.int(field, "minItems", 0, path)),
        maxItems: reader.optionalNumber(field, "maxItems", path),
        itemLabel: reader.string(field, "itemLabel", "Item {n}"),
      };
    }
    case "itemRef":
      return { id, label, type, schema: reader.string(field, "schema", "", path), list: reader.string(field, "list", "", path) };
    case "nodeRef":
      return { id, label, type, schema: reader.string(field, "schema", "", path) };
    case "resource":
      return {
        id,
        label,
        type,
        resourceType: reader.string(field, "resourceType", "", path),
        previewHeight: Math.max(0, reader.number(field, "previewHeight", 140, path)),
      };
    case "resourceVariant":
      return {
        id,
        label,
        type,
        source: reader.string(field, "source", "", path),
        collection: reader.string(field, "collection", "", path),
      };
    case "localizedText":
      return {
        id,
        label,
        type,
        keyFrom: reader.enum(field, "keyFrom", ["name", "none"] as const, path, "name"),
        keySuffix: reader.string(field, "keySuffix", ""),
        multiline: reader.bool(field, "multiline", true),
      };
    case "matrix":
      return {
        id,
        label,
        type,
        rows: reader.string(field, "rows", "", path),
        columns: reader.string(field, "columns", "", path),
        rowLabel: reader.string(field, "rowLabel", "{n}"),
        columnLabel: reader.string(field, "columnLabel", "{n}"),
      };
  }
  throw new SchemaError(`${path}: unreachable field type '${type}'.`);
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

export type NodeData = Record<string, unknown>;

export function defaultValue(field: FieldSchema): unknown {
  switch (field.type) {
    case "int":
    case "float":
    case "string":
    case "bool":
    case "enum":
      return field.default;
    case "record": {
      const record: Record<string, unknown> = { id: newId() };
      for (const child of field.fields) {
        record[child.id] = defaultValue(child);
      }
      return record;
    }
    case "list":
      return Array.from({ length: field.minItems }, () => defaultValue(field.item));
    case "itemRef":
    case "nodeRef":
    case "resource":
    case "resourceVariant":
    case "localizedText":
    case "unsupported":
      return null;
    case "matrix":
      return {};
  }
}

export function createData(schema: NodeSchema): NodeData {
  const data: NodeData = {};
  for (const field of schema.fields) {
    data[field.id] = defaultValue(field);
  }
  return reconcileData(schema, data);
}

/**
 * Coerces loaded data to the schema. Invalid values fall back to defaults (reported through `warn`);
 * keys unknown to the schema are kept so nothing is lost when a schema changes.
 */
export function normalizeData(schema: NodeSchema, raw: unknown, warn: (message: string) => void = () => {}): NodeData {
  const source = isRecord(raw) ? raw : {};
  const data: NodeData = { ...source };
  for (const field of schema.fields) {
    data[field.id] = normalizeValue(field, source[field.id], field.id, warn);
  }
  return reconcileData(schema, data);
}

/**
 * Brings values that depend on other fields up to date — currently matrices, whose rows and columns
 * follow a count or a list. Existing cells keep their value; cells of removed rows/columns are dropped.
 */
export function reconcileData(schema: NodeSchema, data: NodeData): NodeData {
  let result = data;
  for (const field of schema.fields) {
    if (field.type !== "matrix") continue;
    const current = isRecord(data[field.id]) ? (data[field.id] as Record<string, unknown>) : {};
    const next: MatrixValue = {};
    for (const row of dimensionKeys(data, field.rows)) {
      const cells = isRecord(current[row]) ? (current[row] as Record<string, unknown>) : {};
      next[row] = {};
      for (const column of dimensionKeys(data, field.columns)) {
        next[row][column] = cells[column] === true;
      }
    }
    if (!sameMatrix(current, next)) {
      result = result === data ? { ...data } : result;
      result[field.id] = next;
    }
  }
  return result;
}

/** Keys along a matrix dimension: element GUIDs of a list (index when missing) or 0..n-1 of a count. */
export function dimensionKeys(data: NodeData, fieldId: string): string[] {
  const value = data[fieldId];
  if (Array.isArray(value)) {
    return value.map((item, index) => (isRecord(item) && isStableId(item.id) ? item.id : String(index)));
  }
  const count = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return Array.from({ length: count }, (_, index) => String(index));
}

function sameMatrix(a: Record<string, unknown>, b: MatrixValue): boolean {
  const rows = Object.keys(b);
  if (rows.length !== Object.keys(a).length) return false;
  return rows.every((row) => {
    const cells = a[row];
    if (!isRecord(cells)) return false;
    const columns = Object.keys(b[row]);
    return columns.length === Object.keys(cells).length && columns.every((column) => cells[column] === b[row][column]);
  });
}

export function normalizeValue(field: FieldSchema, value: unknown, path: string, warn: (message: string) => void): unknown {
  const fallback = (reason: string) => {
    if (value !== undefined) {
      warn(`${path}: ${reason}; the default value is used.`);
    }
    return defaultValue(field);
  };
  switch (field.type) {
    case "int":
    case "float": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fallback("expected a number");
      }
      const number = field.type === "int" ? Math.round(value) : value;
      return clampNumber(field, number);
    }
    case "string":
      return typeof value === "string" ? value : fallback("expected a string");
    case "bool":
      return typeof value === "boolean" ? value : fallback("expected true or false");
    case "enum":
      return typeof value === "string" && field.options.some((option) => option.value === value)
        ? value
        : fallback(`'${String(value)}' is not an option`);
    case "record": {
      if (!isRecord(value)) {
        return fallback("expected an object");
      }
      const record: Record<string, unknown> = { ...value, id: isStableId(value.id) ? value.id : newId() };
      for (const child of field.fields) {
        record[child.id] = normalizeValue(child, value[child.id], `${path}.${child.id}`, warn);
      }
      return record;
    }
    case "list": {
      if (!Array.isArray(value)) {
        return fallback("expected an array");
      }
      const items = value.map((item, index) => normalizeValue(field.item, item, `${path}[${index}]`, warn));
      while (items.length < field.minItems) {
        items.push(defaultValue(field.item));
      }
      return field.maxItems !== undefined ? items.slice(0, field.maxItems) : items;
    }
    case "itemRef":
    case "nodeRef":
    case "resource":
    case "resourceVariant":
    case "localizedText":
      return value === null || typeof value === "string" ? value ?? null : fallback("expected an id");
    case "matrix":
      return isRecord(value) ? value : fallback("expected an object");
    case "unsupported":
      return value ?? null;
  }
}

export function clampNumber(field: NumberField, value: number): number {
  let result = value;
  if (field.min !== undefined) result = Math.max(field.min, result);
  if (field.max !== undefined) result = Math.min(field.max, result);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------------------------

export interface DerivedPort {
  /** Stable key inside the node: the port id, plus `:<element GUID>` or `:<n>` for repeated ports. */
  key: string;
  schemaPortId: string;
  direction: PortDirection;
  type: string;
  capacity: PortCapacity;
  label: string;
}

export function derivePorts(schema: NodeSchema, data: NodeData, portTypes: Map<string, PortTypeSchema>): DerivedPort[] {
  const result: DerivedPort[] = [];
  for (const port of schema.ports) {
    const capacity =
      port.capacity ?? portTypes.get(port.type)?.capacity[port.direction === "Input" ? "input" : "output"] ??
      (port.direction === "Input" ? "Single" : "Multiple");
    const base = { schemaPortId: port.id, direction: port.direction, type: port.type, capacity };
    const baseLabel = port.label ?? humanize(port.id);
    if (!port.repeat) {
      result.push({ ...base, key: port.id, label: baseLabel });
      continue;
    }
    const template = port.repeat.label ?? `${baseLabel} {n}`;
    if ("list" in port.repeat) {
      const items = Array.isArray(data[port.repeat.list]) ? (data[port.repeat.list] as unknown[]) : [];
      items.forEach((item, index) => {
        const suffix = isRecord(item) && isStableId(item.id) ? item.id : String(index);
        result.push({ ...base, key: `${port.id}:${suffix}`, label: formatLabel(template, index, item) });
      });
    } else {
      const raw = data[port.repeat.count];
      const count = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      for (let index = 0; index < count; index++) {
        result.push({ ...base, key: `${port.id}:${index}`, label: formatLabel(template, index, null) });
      }
    }
  }
  return result;
}

/** `{i}` → 0-based index, `{n}` → 1-based index, `{item.field}` → a field of the list element. */
export function formatLabel(template: string, index: number, item: unknown): string {
  return template.replace(/\{(i|n|item\.([A-Za-z0-9_]+))\}/g, (_, token: string, field?: string) => {
    if (token === "i") return String(index);
    if (token === "n") return String(index + 1);
    const value = isRecord(item) && field ? item[field] : undefined;
    return value === undefined || value === null || value === "" ? "…" : String(value);
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const DIRECTIONS = { input: "Input", output: "Output" } as const;
const CAPACITIES = { single: "Single", multiple: "Multiple" } as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Element ids are GUIDs, but any non-empty string loaded from a document is kept as-is. */
function isStableId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function humanize(id: string): string {
  const spaced = id.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseJson(file: PackFile): unknown {
  try {
    return JSON.parse(file.text);
  } catch (error) {
    throw new SchemaError(`${file.path}: invalid JSON (${(error as Error).message}).`);
  }
}

function checkUniqueIds(reader: Reader, entries: { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      reader.error(path, `duplicate id '${entry.id}'`);
    }
    seen.add(entry.id);
  }
}

/** Collects every problem of a document instead of stopping at the first one. */
class Reader {
  readonly errors: string[] = [];

  constructor(private readonly location: string) {}

  error(path: string, message: string): void {
    this.errors.push(`${this.location}${path ? ` → ${path}` : ""}: ${message}.`);
  }

  object(value: unknown, path: string): Record<string, unknown>;
  object(parent: Record<string, unknown>, key: string, path: string): Record<string, unknown>;
  object(valueOrParent: unknown, keyOrPath: string, path?: string): Record<string, unknown> {
    const value = path === undefined ? valueOrParent : (valueOrParent as Record<string, unknown>)[keyOrPath];
    const at = path === undefined ? keyOrPath : join(path, keyOrPath);
    if (!isRecord(value)) {
      this.error(at, "expected an object");
      return {};
    }
    return value;
  }

  optionalObject(parent: Record<string, unknown>, key: string, path = ""): Record<string, unknown> | undefined {
    const value = parent[key];
    if (value === undefined) return undefined;
    if (!isRecord(value)) {
      this.error(join(path, key), "expected an object");
      return undefined;
    }
    return value;
  }

  array(parent: Record<string, unknown>, key: string, path = ""): unknown[] {
    const value = parent[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      this.error(join(path, key), "expected an array");
      return [];
    }
    return value;
  }

  id(parent: Record<string, unknown>, key: string, path = ""): string {
    const value = parent[key];
    if (typeof value !== "string" || !ID_PATTERN.test(value)) {
      this.error(join(path, key), "expected an id (letters, digits, '.', '-', '_')");
      return typeof value === "string" ? value : "";
    }
    return value;
  }

  string(parent: Record<string, unknown>, key: string, fallback: string, path = ""): string {
    const value = parent[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string") {
      this.error(join(path, key), "expected a string");
      return fallback;
    }
    return value;
  }

  optionalString(parent: Record<string, unknown>, key: string): string | undefined {
    const value = parent[key];
    return typeof value === "string" ? value : undefined;
  }

  stringArray(parent: Record<string, unknown>, key: string, fallback: string[]): string[] {
    const value = parent[key];
    if (value === undefined) return fallback;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      this.error(key, "expected an array of strings");
      return fallback;
    }
    return value as string[];
  }

  number(parent: Record<string, unknown>, key: string, fallback: number, path = ""): number {
    const value = parent[key];
    if (value === undefined) return fallback;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.error(join(path, key), "expected a number");
      return fallback;
    }
    return value;
  }

  optionalNumber(parent: Record<string, unknown>, key: string, path = ""): number | undefined {
    return parent[key] === undefined ? undefined : this.number(parent, key, 0, path);
  }

  int(parent: Record<string, unknown>, key: string, fallback: number, path = ""): number {
    const value = this.number(parent, key, fallback, path);
    if (!Number.isInteger(value)) {
      this.error(join(path, key), "expected an integer");
      return Math.round(value);
    }
    return value;
  }

  bool(parent: Record<string, unknown>, key: string, fallback: boolean): boolean {
    const value = parent[key];
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") {
      this.error(key, "expected true or false");
      return fallback;
    }
    return value;
  }

  color(parent: Record<string, unknown>, key: string): number | null {
    const value = parent[key];
    if (value === undefined) return null;
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
      this.error(key, "expected a color like '#5a96dc'");
      return null;
    }
    return parseInt(value.slice(1), 16);
  }

  enum<T extends string>(parent: Record<string, unknown>, key: string, options: Record<string, T> | readonly T[], path = "", fallback?: T): T {
    const value = parent[key];
    const map = Array.isArray(options)
      ? Object.fromEntries((options as readonly T[]).map((option) => [option, option]))
      : (options as Record<string, T>);
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value === "string" && value in map) return map[value];
    this.error(join(path, key), `expected one of: ${Object.keys(map).join(", ")}`);
    return fallback ?? (Object.values(map)[0] as T);
  }

  optionalEnum<T extends string>(parent: Record<string, unknown>, key: string, options: Record<string, T>, path = ""): T | undefined {
    return parent[key] === undefined ? undefined : this.enum(parent, key, options, path);
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}
