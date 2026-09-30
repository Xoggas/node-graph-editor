import { describe, expect, it } from "vitest";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";
import { searchNodes } from "./search";

const registry = new SchemaRegistry(
  parseSchemaPack([
    { path: "pack.json", text: JSON.stringify({ id: "s", portTypes: { flow: {} } }) },
    {
      path: "nodes/n.json",
      text: JSON.stringify([
        {
          id: "line",
          title: "Line",
          naming: { unique: true },
          fields: [
            { id: "text", type: "localizedText", keyFrom: "name" },
            { id: "mood", type: "enum", options: [{ value: "calm", label: "Спокойный" }, { value: "angry", label: "Злой" }] },
            { id: "notes", type: "list", item: { type: "record", fields: [{ id: "note", type: "string" }] } },
          ],
        },
        { id: "end", title: "End of chapter" },
      ]),
    },
  ]),
);

const texts: Record<string, Record<string, string>> = {
  ru: { "1.1": "Ёжик ушёл в туман", "1.2": "Привет" },
  en: { "1.1": "The hedgehog left", "1.2": "Hello there" },
};
const sources = { languages: ["ru", "en"], text: (language: string, key: string) => texts[language]?.[key] };

function setup() {
  const graph = new GraphModel(registry);
  const first = graph.addNode("line", { x: 0, y: 0 });
  const second = graph.addNode("line", { x: 0, y: 0 });
  const end = graph.addNode("end", { x: 0, y: 0 });
  graph.renameNode(first.id, "1.1");
  graph.renameNode(second.id, "1.2");
  graph.setNodeData(second.id, { ...second.data, mood: "angry", notes: [{ id: crypto.randomUUID(), note: "Check the hedgehog scene" }] });
  return { graph, first, second, end };
}

const find = (graph: GraphModel, query: string) =>
  searchNodes(graph, query, sources).map(({ node, match }) => [node.name || node.schemaId, match?.where ?? null]);

describe("searchNodes", () => {
  it("finds names first, then types, then contents", () => {
    const { graph } = setup();
    expect(find(graph, "1.2")).toEqual([["1.2", "Name"]]);
    expect(find(graph, "chapter")).toEqual([["end", null]]);
    expect(find(graph, "hedgehog")).toEqual([
      ["1.1", "Text · EN"],
      ["1.2", "Notes 1 → Note"],
    ]);
  });

  it("searches texts in every language, options by label, case- and ё-insensitively", () => {
    const { graph } = setup();
    expect(find(graph, "ежик")).toEqual([["1.1", "Text · RU"]]);
    expect(find(graph, "злой")).toEqual([["1.2", "Mood"]]);
    const [result] = searchNodes(graph, "УШЕЛ", sources);
    expect(result.match).toMatchObject({ text: "Ёжик ушёл в туман", start: 5, length: 4 });
  });

  it("returns nothing for an empty query", () => {
    expect(searchNodes(setup().graph, "  ", sources)).toEqual([]);
  });
});
