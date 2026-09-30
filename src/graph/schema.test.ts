import { describe, expect, it } from "vitest";
import { createData, derivePorts, normalizeData, parseSchemaPack, SchemaError } from "./schema";
import { testPackFiles } from "./testPack";

const pack = () => parseSchemaPack(testPackFiles);

describe("parseSchemaPack", () => {
  it("loads port types and node schemas", () => {
    const loaded = pack();
    expect(loaded.id).toBe("test");
    expect([...loaded.portTypes.keys()]).toEqual(["flow", "bool", "number", "integer"]);
    expect(loaded.nodes.get("test.line")?.naming).toMatchObject({ editable: true, unique: true });
    expect(loaded.warnings).toEqual([]);
  });

  it("requires pack.json and rejects unknown parent port types", () => {
    expect(() => parseSchemaPack([])).toThrow(SchemaError);
    expect(() =>
      parseSchemaPack([{ path: "pack.json", text: JSON.stringify({ id: "p", portTypes: { a: { extends: ["missing"] } } }) }]),
    ).toThrow(/unknown type 'missing'/);
  });

  it("skips an invalid node schema with a readable warning and keeps the others", () => {
    const loaded = parseSchemaPack([
      testPackFiles[0],
      {
        path: "nodes/bad.json",
        text: JSON.stringify([
          { id: "ok", ports: [{ id: "in", direction: "input", type: "flow" }] },
          { id: "bad", ports: [{ id: "in", direction: "sideways", type: "nope" }] },
        ]),
      },
    ]);
    expect([...loaded.nodes.keys()]).toEqual(["ok"]);
    expect(loaded.warnings[0]).toContain("nodes/bad.json[1] → ports[0].direction");
    expect(loaded.warnings[0]).toContain("unknown port type 'nope'");
  });

  it("keeps fields of unknown types as unsupported instead of failing", () => {
    const loaded = parseSchemaPack([
      testPackFiles[0],
      { path: "nodes/future.json", text: JSON.stringify({ id: "future", fields: [{ id: "speaker", type: "resource" }] }) },
    ]);
    expect(loaded.nodes.get("future")?.fields[0]).toMatchObject({ type: "unsupported", declaredType: "resource" });
  });

  it("validates repeat sources", () => {
    const loaded = parseSchemaPack([
      testPackFiles[0],
      {
        path: "nodes/n.json",
        text: JSON.stringify({ id: "n", ports: [{ id: "o", direction: "output", type: "flow", repeat: { list: "missing" } }] }),
      },
    ]);
    expect(loaded.nodes.size).toBe(0);
    expect(loaded.warnings[0]).toContain("must name a list field");
  });
});

describe("data", () => {
  it("creates defaults and normalizes loaded values without dropping unknown keys", () => {
    const matrix = pack().nodes.get("test.matrix")!;
    expect(createData(matrix)).toEqual({ outcomes: 2 });

    const warnings: string[] = [];
    const data = normalizeData(matrix, { outcomes: 99, legacy: "kept" }, (message) => warnings.push(message));
    expect(data).toEqual({ outcomes: 4, legacy: "kept" });

    const reset = normalizeData(matrix, { outcomes: "many" }, (message) => warnings.push(message));
    expect(reset.outcomes).toBe(2);
    expect(warnings).toEqual(["outcomes: expected a number; the default value is used."]);
  });

  it("gives list records GUIDs and keeps existing ones", () => {
    const line = pack().nodes.get("test.line")!;
    const data = normalizeData(line, { choices: [{ id: "keep-me", text: "A" }, { text: "B" }] });
    const choices = data.choices as { id: string; text: string; extra: boolean }[];
    expect(choices[0]).toEqual({ id: "keep-me", text: "A", extra: false });
    expect(choices[1].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("derives repeated ports from list elements and counts", () => {
    const loaded = pack();
    const line = loaded.nodes.get("test.line")!;
    const ports = derivePorts(line, { choices: [{ id: "g1", text: "Yes" }, { id: "g2", text: "" }] }, loaded.portTypes);
    expect(ports.map((port) => [port.key, port.label, port.capacity])).toEqual([
      ["in", "In", "Multiple"],
      ["condition:g1", "If Yes", "Single"],
      ["condition:g2", "If …", "Single"],
      ["choice:g1", "Yes", "Single"],
      ["choice:g2", "…", "Single"],
      ["next", "Next", "Single"],
    ]);

    const matrix = loaded.nodes.get("test.matrix")!;
    expect(derivePorts(matrix, { outcomes: 3 }, loaded.portTypes).map((port) => port.key)).toEqual([
      "in",
      "outcome:0",
      "outcome:1",
      "outcome:2",
    ]);
  });
});
