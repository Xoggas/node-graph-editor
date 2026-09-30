import { type ClipboardData, copyViews, pasteViews } from "../graph/clipboard";
import { type GraphChange, GraphModel } from "../graph/graph";
import { GraphHistory } from "../graph/history";
import { LOCALIZATION_DIR, type LocalizationChange, LocalizationStore, localizedEntries } from "../graph/localization";
import { autoName } from "../graph/naming";
import { type NodeDescriptor, SchemaRegistry } from "../graph/registry";
import { type DataPath, getIn, listAdd, listMove, listRemove, setIn } from "../graph/dataOps";
import { defaultVariant } from "../graph/resources";
import { type NodeData, type NodeSchema, type PackFile, parseSchemaPack, reconcileData } from "../graph/schema";
import { exportRuntimeGraph } from "../graph/export";
import { GraphJsonSerializer } from "../graph/serializer";
import type { Vec2 } from "../graph/types";
import { bundledPack } from "./bundledPack";
import { createFileSystem, type GraphFileSystem, type OpenedFile } from "./files";

export interface PackInfo {
  id: string;
  name: string;
  version: number;
  /** Folder path, or a label for the built-in pack. */
  source: string;
  nodeCount: number;
  resourceCount: number;
}

/** `info` goes to the status bar; warnings and errors also pop up as toasts. */
export type StatusKind = "info" | "warning" | "error";

/** A warning or error, delivered to toast listeners one by one (snapshots only keep the last status). */
export interface Notice {
  kind: Exclude<StatusKind, "info">;
  message: string;
}

export interface EditorSnapshot {
  status: string;
  statusKind: StatusKind;
  /** Incremented on every status message, so repeated identical messages are still noticed. */
  statusId: number;
  dirty: boolean;
  fileName: string | null;
  /** Full path of the document on disk; null until saved (always null in a plain browser). */
  filePath: string | null;
  nodeCount: number;
  connectionCount: number;
  selectionCount: number;
  /** Problems found while loading the current document. */
  warnings: readonly string[];
  pack: PackInfo | null;
  /** Problems found while loading the schema pack. */
  packWarnings: readonly string[];
  languages: readonly string[];
  /** Language whose texts nodes show. */
  displayLanguage: string | null;
  /** Localization texts changed since the last save. */
  localizationDirty: boolean;
  descriptors: readonly NodeDescriptor[];
  canUndo: boolean;
  canRedo: boolean;
  canPaste: boolean;
}

/** Approximate node size, used to center pasted nodes on the cursor. */
const NODE_SIZE_ESTIMATE = { width: 220, height: 110 };
const PASTE_STEP = 32;
/** Where a new linked copy appears relative to the node it links to. */
const LINK_OFFSET = { x: 48, y: 48 };
const PACK_FOLDER_KEY = "node-graph-editor.packFolder";
/** Path of the last opened or saved graph, reopened on start. */
const LAST_GRAPH_KEY = "node-graph-editor.lastGraph";

export interface GraphReplacedOptions {
  /** Fit the whole graph into view instead of restoring the saved viewport. */
  frameAll: boolean;
}

type GraphReplacedListener = (graph: GraphModel, options: GraphReplacedOptions) => void;
type LocalizationListener = (change: LocalizationChange | null) => void;

export class Editor {
  private currentRegistry = new SchemaRegistry();
  private packSource: { kind: "folder"; path: string } | { kind: "bundled" } | null = null;
  private readonly files: GraphFileSystem;
  private currentGraph: GraphModel;
  private unsubscribeGraph: () => void = () => {};
  private readonly listeners = new Set<() => void>();
  private readonly graphReplacedListeners = new Set<GraphReplacedListener>();
  private filePath: string | null = null;
  /** Where the current document was last exported to (this session). */
  private exportPath: string | null = null;
  private state: EditorSnapshot;
  private notifyScheduled = false;
  private readonly history = new GraphHistory(() =>
    this.update({ canUndo: this.history.canUndo, canRedo: this.history.canRedo }),
  );
  private clipboard: ClipboardData | null = null;
  private pasteCount = 0;
  private localizationStore = new LocalizationStore([]);
  private unobserveLocalization: () => void = () => {};
  private readonly localizationListeners = new Set<LocalizationListener>();
  private readonly noticeListeners = new Set<(notice: Notice) => void>();

  constructor(options: { files?: GraphFileSystem } = {}) {
    this.files = options.files ?? createFileSystem();
    this.currentGraph = new GraphModel(this.currentRegistry);
    this.state = {
      status: "",
      statusKind: "info",
      statusId: 0,
      dirty: false,
      fileName: null,
      filePath: null,
      nodeCount: 0,
      connectionCount: 0,
      selectionCount: 0,
      warnings: [],
      pack: null,
      packWarnings: [],
      languages: [],
      displayLanguage: null,
      localizationDirty: false,
      descriptors: [],
      canUndo: false,
      canRedo: false,
      canPaste: false,
    };
    this.attach(this.currentGraph);
  }

  get graph(): GraphModel {
    return this.currentGraph;
  }

  get registry(): SchemaRegistry {
    return this.currentRegistry;
  }

  get localization(): LocalizationStore {
    return this.localizationStore;
  }

  /** Called with the change, or with null when all texts may have changed (pack reload, language switch). */
  /** Warnings and errors, as they happen. */
  onNotice(listener: (notice: Notice) => void): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  onLocalizationChanged(listener: LocalizationListener): () => void {
    this.localizationListeners.add(listener);
    return () => this.localizationListeners.delete(listener);
  }

  // --- React store protocol -------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): EditorSnapshot => this.state;

  onGraphReplaced(listener: GraphReplacedListener): () => void {
    this.graphReplacedListeners.add(listener);
    return () => this.graphReplacedListeners.delete(listener);
  }

  // --- Schema pack ------------------------------------------------------------

  /** Loads the remembered pack folder, or the built-in example pack. */
  /** Startup: the last schema pack folder, then the last opened or saved graph. */
  async start(): Promise<void> {
    await this.loadInitialPack();
    await this.reopenLastGraph();
  }

  private async reopenLastGraph(): Promise<void> {
    const path = readStored(LAST_GRAPH_KEY);
    if (!path) {
      return;
    }
    try {
      const file = await this.files.readFile(path);
      this.openFile(file);
    } catch (error) {
      removeStored(LAST_GRAPH_KEY);
      this.setStatus(`Could not reopen the last graph '${path}': ${errorMessage(error)}`, "warning");
    }
  }

  async loadInitialPack(): Promise<void> {
    const folder = readStored(PACK_FOLDER_KEY);
    if (folder) {
      try {
        await this.loadPackFolder(folder);
        return;
      } catch (error) {
        this.setStatus(`Could not load the schema pack from '${folder}': ${errorMessage(error)}`, "error");
      }
    }
    this.applyPack(bundledPack.files, { kind: "bundled" });
  }

  async choosePackFolder(): Promise<void> {
    try {
      if (!(await this.confirmDiscardLocalization())) {
        return;
      }
      const folder = await this.files.pickPackFolder();
      if (!folder) {
        return;
      }
      await this.loadPackFolder(folder);
    } catch (error) {
      this.setStatus(`Could not load the schema pack: ${errorMessage(error)}`, "error");
    }
  }

  async reloadPack(): Promise<void> {
    try {
      if (!(await this.confirmDiscardLocalization())) {
        return;
      }
      if (this.packSource?.kind === "folder") {
        await this.loadPackFolder(this.packSource.path);
      } else {
        this.applyPack(bundledPack.files, { kind: "bundled" });
      }
    } catch (error) {
      this.setStatus(`Could not reload the schema pack: ${errorMessage(error)}`, "error");
    }
  }

  private async loadPackFolder(folder: string): Promise<void> {
    const files = await this.files.readPackFolder(folder);
    this.applyPack(files, { kind: "folder", path: folder });
    writeStored(PACK_FOLDER_KEY, folder);
  }

  /** Switches to a new pack and rebinds the open graph to it; node data is preserved. */
  applyPack(files: PackFile[], source: NonNullable<Editor["packSource"]>): void {
    const packDir = source.kind === "folder" ? source.path : bundledPack.dir;
    const pack = parseSchemaPack(files, packDir);
    const localization = LocalizationStore.fromFiles(pack.languages, files, pack.warnings);
    this.files.setResourceRoots(pack.resources.roots).catch((error) => this.setStatus(`Resource folders: ${errorMessage(error)}`, "error"));
    const registry = new SchemaRegistry(pack);
    const json = new GraphJsonSerializer(this.currentRegistry).serialize(this.graph);
    const { graph, warnings } = new GraphJsonSerializer(registry).deserialize(json);
    const dirty = this.state.dirty;

    this.currentRegistry = registry;
    this.packSource = source;
    this.attach(graph);
    this.setLocalization(localization);
    const displayLanguage =
      this.state.displayLanguage && pack.languages.includes(this.state.displayLanguage) ? this.state.displayLanguage : pack.languages[0] ?? null;
    this.update({
      pack: {
        id: pack.id,
        name: pack.name,
        version: pack.version,
        source: source.kind === "folder" ? source.path : bundledPack.label,
        nodeCount: pack.nodes.size,
        resourceCount: pack.resources.items.size,
      },
      packWarnings: pack.warnings,
      languages: pack.languages,
      displayLanguage,
      localizationDirty: false,
      descriptors: registry.descriptors(),
      warnings: warnings.filter((warning) => !warning.startsWith("The graph was made with schema pack")),
      dirty,
      statusKind: pack.warnings.length === 0 ? "info" : "warning",
      status:
        pack.warnings.length === 0
          ? `Schema pack loaded: ${pack.name} (${pack.nodes.size} nodes).`
          : `Schema pack loaded with ${pack.warnings.length} problem(s).`,
    });
    this.notifyGraphReplaced(graph, false);
    this.notifyLocalization(null);
  }

  // --- Localization -----------------------------------------------------------

  setDisplayLanguage(language: string): void {
    if (this.state.languages.includes(language) && language !== this.state.displayLanguage) {
      this.update({ displayLanguage: language });
      this.notifyLocalization(null);
    }
  }

  /** Sets texts of one key in several languages as one undo step. */
  setTexts(key: string, texts: Record<string, string>): void {
    for (const [language, text] of Object.entries(texts)) {
      this.localizationStore.set(language, key, text === "" && this.localizationStore.get(language, key) === undefined ? undefined : text);
    }
  }

  private setLocalization(store: LocalizationStore): void {
    this.unobserveLocalization();
    this.localizationStore = store;
    const unsubscribe = store.subscribe((change) => {
      this.update({ localizationDirty: store.isDirty });
      this.notifyLocalization(change);
    });
    const unobserve = this.history.observe<LocalizationChange>(
      (listener) => store.subscribe(listener),
      (change) => ({
        undo: () => store.set(change.language, change.key, change.previous),
        redo: () => store.set(change.language, change.key, change.next),
      }),
    );
    this.unobserveLocalization = () => {
      unsubscribe();
      unobserve();
    };
  }

  private notifyLocalization(change: LocalizationChange | null): void {
    for (const listener of this.localizationListeners) {
      listener(change);
    }
  }

  private async confirmDiscardLocalization(): Promise<boolean> {
    return !this.localizationStore.isDirty || this.files.confirm("Discard unsaved localization changes?");
  }

  /** Writes changed language files into the pack folder. */
  private async saveLocalization(): Promise<string | null> {
    const store = this.localizationStore;
    if (!store.isDirty) {
      return null;
    }
    const packDir = this.packSource?.kind === "folder" ? this.packSource.path : bundledPack.dir;
    if (!packDir) {
      throw new Error("the built-in pack cannot be written; choose the pack folder first");
    }
    const languages = [...store.dirtyLanguages];
    for (const language of languages) {
      await this.files.writePackFile(packDir, `${LOCALIZATION_DIR}/${language}.json`, store.serialize(language));
      store.markSaved(language);
    }
    this.update({ localizationDirty: store.isDirty });
    return languages.join(", ");
  }

  // --- Document commands -----------------------------------------------------

  async newGraph(): Promise<void> {
    if (!(await this.confirmDiscard())) {
      return;
    }
    this.replaceGraph(new GraphModel(this.registry), null, "New graph.", [], false);
  }

  async open(): Promise<void> {
    try {
      if (!(await this.confirmDiscard())) {
        return;
      }
      const file = await this.files.open();
      if (!file) {
        return;
      }
      this.openFile(file);
    } catch (error) {
      this.setStatus(`Open failed: ${errorMessage(error)}`, "error");
    }
  }

  private openFile(file: OpenedFile): void {
    const { graph, warnings } = new GraphJsonSerializer(this.registry).deserialize(file.text);
    const status = warnings.length === 0 ? `Opened: ${file.name}` : `Opened ${file.name} with ${warnings.length} warning(s).`;
    this.replaceGraph(graph, file.path, status, warnings, false);
    this.update({ fileName: file.name });
    if (file.path) writeStored(LAST_GRAPH_KEY, file.path);
  }

  async save(chooseLocation = false): Promise<void> {
    let savedLanguages: string | null = null;
    try {
      savedLanguages = await this.saveLocalization();
    } catch (error) {
      this.setStatus(`Localization was not saved: ${errorMessage(error)}`, "error");
      return;
    }
    try {
      const json = new GraphJsonSerializer(this.registry).serialize(this.graph);
      const saved = await this.files.save(json, this.filePath, chooseLocation);
      if (!saved) {
        if (savedLanguages) this.setStatus(`Saved localization (${savedLanguages}); the graph was not saved.`, "warning");
        return;
      }
      this.filePath = saved.path;
      if (saved.path) writeStored(LAST_GRAPH_KEY, saved.path);
      const localizationNote = savedLanguages ? ` and localization (${savedLanguages})` : "";
      this.update({ dirty: false, fileName: saved.name, filePath: saved.path, status: `Saved: ${saved.name}${localizationNote}` });
    } catch (error) {
      this.setStatus(`Save failed: ${errorMessage(error)}`, "error");
    }
  }

  /**
   * Writes the engine version of the graph (no editor data, see `exportRuntimeGraph`) and, next to
   * it, `localization/<language>.json` with the texts as they are in the editor (unsaved edits
   * included). Re-exports go to the last export path; `chooseLocation` or a first export asks where.
   */
  async exportGraph(chooseLocation = false): Promise<void> {
    try {
      const { graph, warnings } = exportRuntimeGraph(this.graph);
      const baseName = (this.state.fileName ?? "graph").replace(/\.json$/i, "");
      const defaultPath = this.filePath ? this.filePath.replace(/[^\\/]*$/, `${baseName}.runtime.json`) : `${baseName}.runtime.json`;
      const saved = await this.files.save(JSON.stringify(graph), this.exportPath, chooseLocation || !this.exportPath, {
        title: "Export runtime graph",
        defaultPath,
      });
      if (!saved) {
        return;
      }
      this.exportPath = saved.path;
      const languages = this.state.languages;
      const directory = saved.path ? saved.path.replace(/[^\\/]*$/, "") : "";
      for (const language of languages) {
        await this.files.writeFile(`${directory}${LOCALIZATION_DIR}/${language}.json`, this.localizationStore.serialize(language));
      }
      const count = Object.keys(graph.nodes).length;
      const texts = languages.length > 0 ? ` and localization (${languages.join(", ")})` : "";
      this.update({
        warnings,
        statusKind: warnings.length === 0 ? "info" : "warning",
        status:
          warnings.length === 0
            ? `Exported ${count} node(s)${texts} to ${saved.name}.`
            : `Exported ${count} node(s)${texts} to ${saved.name} with ${warnings.length} warning(s).`,
      });
    } catch (error) {
      this.setStatus(`Export failed: ${errorMessage(error)}`, "error");
    }
  }

  // --- Graph commands --------------------------------------------------------

  addNode(schemaId: string, position: Vec2): string | null {
    const schema = this.registry.getSchema(schemaId);
    if (schema?.singleton && [...this.graph.nodes].some((node) => node.schemaId === schemaId)) {
      this.setStatus(`Only one '${schema.title}' node is allowed per graph.`, "error");
      return null;
    }
    try {
      const node = this.graph.addNode(schemaId, position);
      const name = schema ? autoName(this.graph, schema) : null;
      if (name) {
        this.graph.renameNode(node.id, name);
      }
      return node.id;
    } catch (error) {
      this.setStatus(`Could not add node: ${errorMessage(error)}`, "error");
      return null;
    }
  }

  /** Deletes views (a node takes its aliases along; an alias goes alone) and connections. */
  deleteElements(viewIds: Iterable<string>, connectionIds: Iterable<string>): void {
    let removed = 0;
    for (const id of connectionIds) {
      removed += this.graph.disconnect(id) ? 1 : 0;
    }
    for (const id of viewIds) {
      removed += this.graph.removeView(id) ? 1 : 0;
    }
    if (removed > 0) {
      this.setStatus(`Deleted ${removed} element(s).`);
    }
  }

  /**
   * Adds a linked copy of each node shown by the given views, next to that view. Returns the new
   * alias ids.
   */
  createLinkedCopies(viewIds: Iterable<string>): string[] {
    const created: string[] = [];
    for (const viewId of viewIds) {
      const node = this.graph.viewNode(viewId);
      const position = this.graph.viewPosition(viewId);
      if (!node || !position) continue;
      created.push(this.graph.addAlias(node.id, { x: position.x + LINK_OFFSET.x, y: position.y + LINK_OFFSET.y }).id);
    }
    if (created.length > 0) {
      this.setStatus(`Created ${created.length} linked cop${created.length === 1 ? "y" : "ies"}.`);
    }
    return created;
  }

  /** Connects two ports given in any order; the view ids say where each end is drawn. */
  connectPorts(firstPortId: string, secondPortId: string, firstViewId?: string, secondViewId?: string): void {
    const first = this.graph.getPort(firstPortId);
    const second = this.graph.getPort(secondPortId);
    if (!first || !second || first.id === second.id) {
      this.setStatus("Connection cancelled.");
      return;
    }
    if (first.direction === second.direction) {
      this.setStatus("A connection must go from Output to Input.", "error");
      return;
    }
    const [output, input] = first.direction === "Output" ? [first, second] : [second, first];
    const views = first.direction === "Output" ? { output: firstViewId, input: secondViewId } : { output: secondViewId, input: firstViewId };
    const result = this.graph.connect(output.id, input.id, undefined, views);
    if (result.success) {
      this.setStatus(`Connected ${output.displayName} → ${input.displayName}.`);
    } else {
      this.setStatus(result.message, "error");
    }
  }

  /** Sets a value in a node's data; `path` is a field id followed by list indices / record field ids. */
  setValue(nodeId: string, path: DataPath, value: unknown): void {
    const node = this.graph.getNode(nodeId);
    if (!node || Object.is(getIn(node.data, path), value)) {
      return;
    }
    this.updateData(nodeId, (data) => setIn(data, path, value));
  }

  /** Reads a resource file (e.g. an image) of the loaded pack. */
  readResource(path: string): Promise<Blob> {
    return this.files.readResource(path);
  }

  setField(nodeId: string, fieldId: string, value: unknown): void {
    this.setValue(nodeId, [fieldId], value);
  }

  addListItem(nodeId: string, path: DataPath): void {
    const node = this.graph.getNode(nodeId);
    if (node?.schema && !this.updateData(nodeId, (data) => listAdd(node.schema!, data, path))) {
      this.setStatus("The list is full.", "error");
    }
  }

  removeListItem(nodeId: string, path: DataPath, index: number): void {
    const node = this.graph.getNode(nodeId);
    if (node?.schema && !this.updateData(nodeId, (data) => listRemove(node.schema!, data, path, index))) {
      this.setStatus("This item cannot be removed.", "error");
    }
  }

  moveListItem(nodeId: string, path: DataPath, index: number, delta: number): void {
    this.updateData(nodeId, (data) => listMove(data, path, index, delta));
  }

  toggleMatrixCell(nodeId: string, fieldId: string, row: string, column: string): void {
    const node = this.graph.getNode(nodeId);
    const current = getIn(node?.data, [fieldId, row, column]) === true;
    this.updateData(nodeId, (data) => setIn(data, [fieldId, row, column], !current));
  }

  /** Applies a data transformation, keeps dependent values (matrices) consistent and records it for undo. */
  private updateData(nodeId: string, transform: (data: NodeData) => NodeData | null): boolean {
    const node = this.graph.getNode(nodeId);
    if (!node?.schema) {
      return false;
    }
    const next = transform(node.data);
    if (!next) {
      return false;
    }
    this.graph.setNodeData(nodeId, reconcileData(node.schema, this.reconcileVariants(node.schema, next)));
    return true;
  }

  /** Keeps variant fields (e.g. emotions) valid for the resource currently chosen in their source field. */
  private reconcileVariants(schema: NodeSchema, data: NodeData): NodeData {
    const library = this.registry.pack?.resources;
    if (!library) {
      return data;
    }
    let result = data;
    for (const field of schema.fields) {
      if (field.type !== "resourceVariant") continue;
      const source = data[field.source];
      const item = typeof source === "string" ? library.items.get(source) : undefined;
      const current = data[field.id];
      let next: string | null;
      if (!item) {
        next = null;
      } else if (typeof current === "string" && (item.variants.get(field.collection) ?? []).some((variant) => variant.id === current)) {
        next = current;
      } else {
        next = defaultVariant(library, item, field.collection);
      }
      if (next !== current) {
        result = { ...result, [field.id]: next };
      }
    }
    return result;
  }

  /** Renames a node, enforcing the schema's naming rules. Returns false when the name was rejected. */
  renameNode(nodeId: string, rawName: string): boolean {
    const node = this.graph.getNode(nodeId);
    const naming = node?.schema?.naming;
    if (!node || !naming?.editable) {
      return false;
    }
    const name = rawName.trim();
    if (name && naming.pattern && !naming.pattern.test(name)) {
      this.setStatus(`'${name}' is not a valid name for '${node.schema!.title}'.`, "error");
      return false;
    }
    if (name && naming.unique) {
      const clash = [...this.graph.nodes].find(
        (other) => other !== node && other.schema?.naming.unique && other.name === name,
      );
      if (clash) {
        this.setStatus(`The name '${name}' is already used by another node.`, "error");
        return false;
      }
    }
    // Texts keyed by the node name follow it to the new name, in the same undo step.
    const before = localizedEntries(node).map((entry) => entry.key);
    this.graph.renameNode(nodeId, name);
    localizedEntries(node).forEach((entry, index) => {
      const from = before[index];
      if (from && entry.key && from !== entry.key) {
        this.localizationStore.move(from, entry.key);
      }
    });
    return true;
  }

  // --- History ------------------------------------------------------------------

  undo(): void {
    this.setStatus(this.history.undo() ? "Undo." : "Nothing to undo.");
  }

  redo(): void {
    this.setStatus(this.history.redo() ? "Redo." : "Nothing to redo.");
  }

  /** Groups every change until `endInteraction()` into one undo step (e.g. a drag). */
  beginInteraction(): void {
    this.history.begin();
  }

  endInteraction(): void {
    this.history.end();
  }

  // --- Clipboard ----------------------------------------------------------------

  /** Copies views: nodes and linked copies (see `copyViews`). */
  copy(viewIds: Iterable<string>): boolean {
    const data = copyViews(this.graph, viewIds);
    if (!data) {
      return false;
    }
    this.clipboard = data;
    this.pasteCount = 0;
    this.update({ canPaste: true, status: `Copied ${data.nodes.length + data.aliases.length} node(s).` });
    return true;
  }

  cut(viewIds: Iterable<string>): boolean {
    const ids = [...viewIds];
    if (!this.copy(ids)) {
      return false;
    }
    this.deleteElements(ids, []);
    this.setStatus(`Cut ${ids.length} node(s).`);
    return true;
  }

  /**
   * Pastes the clipboard centered at `center` (graph coordinates), or offset from the
   * original position when no center is given. Returns the ids of the new views.
   */
  paste(center?: Vec2): string[] {
    const data = this.clipboard;
    if (!data) {
      return [];
    }
    let offset: Vec2;
    if (center) {
      offset = {
        x: center.x - (data.bounds.minX + data.bounds.maxX + NODE_SIZE_ESTIMATE.width) / 2,
        y: center.y - (data.bounds.minY + data.bounds.maxY + NODE_SIZE_ESTIMATE.height) / 2,
      };
    } else {
      this.pasteCount++;
      offset = { x: PASTE_STEP * this.pasteCount, y: PASTE_STEP * this.pasteCount };
    }
    return this.insert(data, offset, "Pasted");
  }

  duplicate(viewIds: Iterable<string>): string[] {
    const data = copyViews(this.graph, viewIds);
    return data ? this.insert(data, { x: PASTE_STEP, y: PASTE_STEP }, "Duplicated") : [];
  }

  private insert(data: ClipboardData, offset: Vec2, verb: string): string[] {
    const singletons = data.nodes.filter(
      (entry) => this.registry.getSchema(entry.schemaId)?.singleton && [...this.graph.nodes].some((node) => node.schemaId === entry.schemaId),
    );
    if (singletons.length > 0) {
      this.setStatus(`${verb} failed: only one '${this.registry.getSchema(singletons[0].schemaId)!.title}' node is allowed.`, "error");
      return [];
    }
    try {
      const { nodeIds, viewIds } = pasteViews(this.graph, data, offset);
      nodeIds.forEach((id, index) => {
        const node = this.graph.getNode(id)!;
        const name = node.schema ? autoName(this.graph, node.schema) : null;
        if (name) {
          this.graph.renameNode(id, name);
        }
        // Copies keep their texts under their own keys.
        const entry = data.nodes[index];
        const sourceKeys = localizedEntries({ name: entry.name, schema: node.schema, data: entry.data }).map((item) => item.key);
        localizedEntries(node).forEach((item, itemIndex) => {
          const from = sourceKeys[itemIndex];
          if (from && item.key && from !== item.key) {
            this.localizationStore.copy(from, item.key);
          }
        });
      });
      this.setStatus(`${verb} ${viewIds.length} node(s).`);
      return viewIds;
    } catch (error) {
      this.setStatus(`${verb} failed: ${errorMessage(error)}`, "error");
      return [];
    }
  }

  setSelectionCount(selectionCount: number): void {
    if (selectionCount !== this.state.selectionCount) {
      this.update({ selectionCount });
    }
  }

  setStatus(status: string, statusKind: StatusKind = "info"): void {
    this.update({ status, statusKind });
  }

  /**
   * Replaces the document with a generated grid of `nodeCount` nodes for performance checks. Uses the
   * first schema that has a plain input and output of compatible types, and chains nodes row by row.
   */
  async generateStressGraph(nodeCount = 1000): Promise<void> {
    const schema = [...(this.registry.pack?.nodes.values() ?? [])].find((candidate) => {
      const input = candidate.ports.find((port) => port.direction === "Input" && !port.repeat);
      const output = candidate.ports.find((port) => port.direction === "Output" && !port.repeat);
      return input && output && this.registry.isAssignable(input.type, output.type);
    });
    if (!schema) {
      this.setStatus("The schema pack has no node with a connectable input and output.", "error");
      return;
    }
    if (!(await this.confirmDiscard())) {
      return;
    }
    const started = performance.now();
    const graph = new GraphModel(this.registry);
    const columns = Math.max(2, Math.round(Math.sqrt(nodeCount / 1.6)));
    graph.batch(() => {
      const grid: string[][] = [];
      for (let index = 0; index < nodeCount; index++) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const node = graph.addNode(schema.id, { x: column * 320, y: row * 180 });
        (grid[row] ??= []).push(node.id);
      }
      const input = schema.ports.find((port) => port.direction === "Input" && !port.repeat)!.id;
      const output = schema.ports.find((port) => port.direction === "Output" && !port.repeat)!.id;
      const portOf = (nodeId: string, key: string) => `${nodeId}/${key}`;
      grid.forEach((row, rowIndex) => {
        row.forEach((id, column) => {
          const target = row[column + 1] ?? grid[rowIndex + 1]?.[0];
          if (target) {
            graph.connect(portOf(id, output), portOf(target, input));
          }
        });
      });
    });
    const elapsed = Math.round(performance.now() - started);
    this.replaceGraph(
      graph,
      null,
      `Generated ${graph.nodeCount} '${schema.title}' nodes and ${graph.connectionCount} connections in ${elapsed} ms.`,
      [],
      true,
    );
    this.update({ dirty: true });
  }

  // --- Internals ---------------------------------------------------------------

  private async confirmDiscard(): Promise<boolean> {
    return !this.state.dirty || this.files.confirm("Discard unsaved changes?");
  }

  private replaceGraph(graph: GraphModel, filePath: string | null, status: string, warnings: string[], frameAll: boolean): void {
    this.attach(graph);
    this.filePath = filePath;
    this.exportPath = null;
    this.update({ status, warnings, dirty: false, fileName: null, filePath, selectionCount: 0 });
    this.notifyGraphReplaced(graph, frameAll);
  }

  private notifyGraphReplaced(graph: GraphModel, frameAll: boolean): void {
    for (const listener of this.graphReplacedListeners) {
      listener(graph, { frameAll });
    }
  }

  private attach(graph: GraphModel): void {
    this.unsubscribeGraph();
    this.currentGraph = graph;
    this.unsubscribeGraph = graph.subscribe((change) => this.onGraphChanged(change));
    this.history.attach(graph);
    this.syncCounts();
  }

  private onGraphChanged(change: GraphChange): void {
    if (change.kind === "viewportChanged") {
      return;
    }
    const structural = change.kind !== "nodeMoved" && change.kind !== "nodeDataChanged" && change.kind !== "nodeRenamed";
    if (structural) {
      this.syncCounts({ dirty: true });
    } else if (!this.state.dirty) {
      this.update({ dirty: true });
    }
  }

  private syncCounts(extra: Partial<EditorSnapshot> = {}): void {
    this.update({ nodeCount: this.graph.nodeCount, connectionCount: this.graph.connectionCount, ...extra });
  }

  private update(patch: Partial<EditorSnapshot>): void {
    const statusId = patch.status !== undefined ? this.state.statusId + 1 : this.state.statusId;
    const statusKind = patch.status !== undefined ? (patch.statusKind ?? "info") : this.state.statusKind;
    this.state = { ...this.state, ...patch, statusId, statusKind };
    if (patch.status && statusKind !== "info") {
      for (const listener of this.noticeListeners) {
        listener({ kind: statusKind, message: patch.status });
      }
    }
    // Bulk graph edits can produce thousands of changes in one task; notify React once.
    if (!this.notifyScheduled) {
      this.notifyScheduled = true;
      queueMicrotask(() => {
        this.notifyScheduled = false;
        for (const listener of this.listeners) {
          listener();
        }
      });
    }
  }
}

// Remembered paths are a convenience only: storage failures are ignored.

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignored
  }
}

function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignored
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
