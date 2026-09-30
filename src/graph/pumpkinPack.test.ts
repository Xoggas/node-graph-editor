import { describe, expect, it } from "vitest";
import { bundledPack } from "../app/bundledPack";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";

describe("pumpkin-quest pack", () => {
  const pack = parseSchemaPack(bundledPack.files);

  it("parses without warnings", () => {
    expect(pack.warnings).toEqual([]);
    expect(pack.nodes.size).toBe(21);
  });

  it("instantiates every node schema", () => {
    const graph = new GraphModel(new SchemaRegistry(pack));
    for (const schemaId of pack.nodes.keys()) {
      expect(() => graph.addNode(schemaId, { x: 0, y: 0 })).not.toThrow();
    }
  });

  it("references Choice nodes from choice conditions and the choice matrix", () => {
    const refs = ["condition.choice-was-made", "condition.choices-were-made", "dialogue.choice-matrix"].map((id) =>
      JSON.stringify(pack.nodes.get(id)!.fields),
    );
    expect(refs.every((fields) => fields.includes('"schema":"dialogue.choice"'))).toBe(true);
    expect(pack.nodes.get("dialogue.line")!.ports.map((port) => port.id)).toEqual(["in", "next"]);
  });
});
