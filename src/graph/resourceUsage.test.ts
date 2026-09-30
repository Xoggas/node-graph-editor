import { describe, expect, it } from "vitest";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { resourceUsage } from "./resourceUsage";
import { parseSchemaPack } from "./schema";

const registry = new SchemaRegistry(
  parseSchemaPack([
    { path: "pack.json", text: JSON.stringify({ id: "r", portTypes: {}, resourceTypes: { character: {}, background: {} } }) },
    {
      path: "nodes/n.json",
      text: JSON.stringify([
        {
          id: "scene",
          fields: [
            { id: "background", type: "resource", resourceType: "background" },
            {
              id: "cast",
              type: "list",
              item: { type: "record", fields: [{ id: "character", type: "resource", resourceType: "character" }] },
            },
          ],
        },
      ]),
    },
  ]),
);

describe("resourceUsage", () => {
  it("finds resources in plain fields, lists and records, once per node", () => {
    const graph = new GraphModel(registry);
    const first = graph.addNode("scene", { x: 0, y: 0 });
    const second = graph.addNode("scene", { x: 0, y: 0 });
    graph.setNodeData(first.id, {
      ...first.data,
      background: "kitchen",
      cast: [
        { id: "a", character: "arleen" },
        { id: "b", character: "arleen" },
      ],
    });
    graph.setNodeData(second.id, { ...second.data, background: "kitchen", cast: [{ id: "c", character: "mother" }] });

    const usage = resourceUsage(graph);
    expect(usage.get("kitchen")).toEqual([first.id, second.id]);
    expect(usage.get("arleen")).toEqual([first.id]);
    expect(usage.get("mother")).toEqual([second.id]);
    expect(usage.has("")).toBe(false);
  });
});
