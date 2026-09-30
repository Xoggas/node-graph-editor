import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "./editor";
import type { GraphFileSystem } from "./files";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const packFiles = [
  {
    path: "pack.json",
    text: JSON.stringify({ id: "loc", name: "Loc", languages: ["ru", "en"], portTypes: { flow: {} } }),
  },
  {
    path: "nodes/line.json",
    text: JSON.stringify({
      id: "line",
      title: "Line",
      naming: { unique: true, auto: "chapter.index" },
      ports: [{ id: "in", direction: "input", type: "flow" }],
      fields: [{ id: "text", type: "localizedText", keyFrom: "name" }],
    }),
  },
  { path: "localization/ru.json", text: JSON.stringify({ "1.1": "Привет" }) },
  { path: "localization/en.json", text: JSON.stringify({ "1.1": "Hello" }) },
];

class FakeFiles implements Partial<GraphFileSystem> {
  written = new Map<string, string>();
  async confirm() {
    return true;
  }
  async setResourceRoots() {}
  async writePackFile(packDir: string, path: string, contents: string) {
    this.written.set(`${packDir}|${path}`, contents);
  }
  async writeFile(path: string, contents: string) {
    this.written.set(path, contents);
  }
  async readPackFolder() {
    return packFiles;
  }
  /** Files on "disk" for `readFile`, by path. */
  disk = new Map<string, string>();
  async readFile(path: string) {
    const text = this.disk.get(path);
    if (text === undefined) throw new Error("file not found");
    return { path, name: path.split("/").pop()!, text };
  }
  saves: { text: string; current: string | null; choose: boolean; defaultPath?: string }[] = [];
  async save(text: string, current: string | null, choose: boolean, options: { defaultPath?: string } = {}) {
    this.saves.push({ text, current, choose, defaultPath: options.defaultPath });
    const path = current ?? options.defaultPath ?? "C:/graphs/g.json";
    return { path, name: path.split("/").pop()! };
  }
}

let files: FakeFiles;
let editor: Editor;

beforeEach(async () => {
  files = new FakeFiles();
  editor = new Editor({ files: files as unknown as GraphFileSystem });
  editor.applyPack(packFiles, { kind: "folder", path: "C:/pack" });
  await tick();
});

const texts = (key: string) => ({ ru: editor.localization.get("ru", key), en: editor.localization.get("en", key) });

describe("localization", () => {
  it("names new nodes chapter.index and shows existing texts for that key", () => {
    const first = editor.addNode("line", { x: 0, y: 0 })!;
    const second = editor.addNode("line", { x: 0, y: 0 })!;
    expect(editor.graph.getNode(first)!.name).toBe("1.1");
    expect(editor.graph.getNode(second)!.name).toBe("1.2");
    expect(texts("1.1")).toEqual({ ru: "Привет", en: "Hello" });
  });

  it("moves texts with a rename and undoes both together", async () => {
    const id = editor.addNode("line", { x: 0, y: 0 })!;
    await tick();
    expect(editor.renameNode(id, "2.1")).toBe(true);
    await tick();
    expect(texts("2.1")).toEqual({ ru: "Привет", en: "Hello" });
    expect(texts("1.1")).toEqual({ ru: undefined, en: undefined });

    editor.undo();
    expect(editor.graph.getNode(id)!.name).toBe("1.1");
    expect(texts("1.1")).toEqual({ ru: "Привет", en: "Hello" });
    expect(texts("2.1").ru).toBeUndefined();
  });

  it("copies texts to duplicated nodes under their new names", async () => {
    const id = editor.addNode("line", { x: 0, y: 0 })!;
    await tick();
    const [copy] = editor.duplicate([id]);
    expect(editor.graph.getNode(copy)!.name).toBe("1.2");
    expect(texts("1.2")).toEqual({ ru: "Привет", en: "Hello" });
    expect(texts("1.1").ru).toBe("Привет");
  });

  it("edits several languages as one undo step and saves changed files", async () => {
    editor.addNode("line", { x: 0, y: 0 });
    await tick();
    editor.setTexts("1.1", { ru: "Здравствуй", en: "Hi" });
    await tick();
    expect(editor.getSnapshot().localizationDirty).toBe(true);
    editor.undo();
    expect(texts("1.1")).toEqual({ ru: "Привет", en: "Hello" });
    editor.redo();

    await editor.save();
    expect(JSON.parse(files.written.get("C:/pack|localization/ru.json")!)).toEqual({ "1.1": "Здравствуй" });
    expect(JSON.parse(files.written.get("C:/pack|localization/en.json")!)).toEqual({ "1.1": "Hi" });
    expect(editor.getSnapshot().localizationDirty).toBe(false);
    expect(editor.getSnapshot().status).toContain("localization (ru, en)");
  });

  it("does not create empty entries for untouched languages", async () => {
    editor.addNode("line", { x: 0, y: 0 });
    editor.addNode("line", { x: 0, y: 0 });
    await tick();
    editor.setTexts("1.2", { ru: "Новый", en: "" });
    expect(texts("1.2")).toEqual({ ru: "Новый", en: undefined });
  });
});

describe("status", () => {
  it("marks failures as errors so they pop up as toasts", async () => {
    const first = editor.addNode("line", { x: 0, y: 0 })!;
    editor.addNode("line", { x: 0, y: 0 });
    expect(editor.getSnapshot().statusKind).toBe("info");
    expect(editor.renameNode(first, "1.2")).toBe(false);
    expect(editor.getSnapshot()).toMatchObject({ statusKind: "error", status: "The name '1.2' is already used by another node." });
    editor.undo();
    expect(editor.getSnapshot().statusKind).toBe("info");
  });
});

describe("last graph", () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reopens the last saved graph on start and forgets a missing one", async () => {
    const id = editor.addNode("line", { x: 0, y: 0 })!;
    await editor.save();
    files.disk.set("C:/graphs/g.json", files.saves[files.saves.length - 1].text);

    const next = new Editor({ files: files as unknown as GraphFileSystem });
    await next.start();
    expect(next.graph.getNode(id)).toBeDefined();
    expect(next.getSnapshot()).toMatchObject({ fileName: "g.json", filePath: "C:/graphs/g.json", dirty: false });

    files.disk.clear();
    const third = new Editor({ files: files as unknown as GraphFileSystem });
    await third.start();
    expect(third.graph.nodeCount).toBe(0);
    expect(third.getSnapshot().statusKind).toBe("warning");
    expect(storage.has("node-graph-editor.lastGraph")).toBe(false);
  });
});

describe("export", () => {
  it("writes a compact runtime file next to the graph and re-exports without asking", async () => {
    const id = editor.addNode("line", { x: 0, y: 0 })!;
    await editor.save();
    expect(editor.getSnapshot().fileName).toBe("g.json");

    await editor.exportGraph();
    const first = files.saves[files.saves.length - 1]!;
    expect(first).toMatchObject({ current: null, choose: true, defaultPath: "C:/graphs/g.runtime.json" });
    expect(first.text).not.toContain("\n");
    const runtime = JSON.parse(first.text);
    expect(runtime.nodes[id]).toEqual({ type: "line", data: { text: "1.1" } });
    expect(editor.getSnapshot().status).toContain("Exported 1 node(s) and localization (ru, en) to g.runtime.json");
    // Texts go next to the export as they are in the editor, unsaved edits included.
    expect(JSON.parse(files.written.get("C:/graphs/localization/en.json")!)).toEqual({ "1.1": "Hello" });
    editor.setTexts("1.1", { en: "Hi" });
    await editor.exportGraph();
    expect(JSON.parse(files.written.get("C:/graphs/localization/en.json")!)).toEqual({ "1.1": "Hi" });
    expect(files.written.has("C:/graphs/localization/ru.json")).toBe(true);

    expect(files.saves[files.saves.length - 1]).toMatchObject({ current: "C:/graphs/g.runtime.json", choose: false });
    await editor.exportGraph(true);
    expect(files.saves[files.saves.length - 1]).toMatchObject({ choose: true });
  });
});
