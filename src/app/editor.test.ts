import { beforeEach, describe, expect, it } from "vitest";
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
  async readPackFolder() {
    return packFiles;
  }
  async save(_text: string, current: string | null) {
    return { path: current ?? "C:/graphs/g.json", name: "g.json" };
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
