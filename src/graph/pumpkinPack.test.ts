import { describe, expect, it } from "vitest";
import { bundledPack } from "../app/bundledPack";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";

describe("pumpkin-quest pack", () => {
  const pack = parseSchemaPack(bundledPack.files);

  it("parses without warnings", () => {
    expect(pack.warnings).toEqual([]);
    expect(pack.nodes.size).toBe(20);
  });

  it("instantiates every node schema", () => {
    const graph = new GraphModel(new SchemaRegistry(pack));
    for (const schemaId of pack.nodes.keys()) {
      expect(() => graph.addNode(schemaId, { x: 0, y: 0 })).not.toThrow();
    }
  });

  it("adds a condition input and an output per line choice", () => {
    const graph = new GraphModel(new SchemaRegistry(pack));
    const line = graph.addNode("dialogue.line", { x: 0, y: 0 });
    graph.setNodeData(line.id, { ...line.data, choices: [{ id: "a" }, { id: "b" }] });
    expect(line.ports.map((port) => port.key)).toEqual(["in", "condition:a", "condition:b", "choice:a", "choice:b", "next"]);
  });
});
