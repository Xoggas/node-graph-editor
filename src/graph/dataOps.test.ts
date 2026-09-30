import { beforeEach, describe, expect, it } from "vitest";
import { copyNodes, pasteNodes } from "./clipboard";
import { getIn, itemRefCandidates, itemRefLabel, listAdd, listMove, listRemove, nodeRefCandidates, setIn } from "./dataOps";
import { GraphModel } from "./graph";
import type { SchemaRegistry } from "./registry";
import { type ItemRefField, type MatrixValue, type NodeData, type NodeRefField, reconcileData } from "./schema";
import { createTestRegistry } from "./testPack";

let registry: SchemaRegistry;
let graph: GraphModel;

beforeEach(() => {
  registry = createTestRegistry();
  graph = new GraphModel(registry);
});

const at = { x: 0, y: 0 };
const schema = (id: string) => registry.getSchema(id)!;

describe("paths", () => {
  it("reads and writes nested values without touching other branches", () => {
    const data: NodeData = { choices: [{ id: "a", text: "x" }, { id: "b", text: "y" }], other: { keep: true } };
    const next = setIn(data, ["choices", 1, "text"], "z");
    expect(getIn(next, ["choices", 1, "text"])).toBe("z");
    expect(getIn(data, ["choices", 1, "text"])).toBe("y");
    expect(next.other).toBe(data.other);
    expect((next.choices as unknown[])[0]).toBe((data.choices as unknown[])[0]);
  });
});

describe("list operations", () => {
  it("adds records with GUIDs up to maxItems, removes and moves them", () => {
    const line = schema("test.line");
    let data: NodeData = { text: "", choices: [] };
    for (let i = 0; i < 5; i++) {
      data = listAdd(line, data, ["choices"])!;
    }
    expect((data.choices as { id: string }[]).every((item) => /^[0-9a-f-]{36}$/.test(item.id))).toBe(true);
    expect(listAdd(line, data, ["choices"])).toBeNull();

    const ids = (data.choices as { id: string }[]).map((item) => item.id);
    const moved = listMove(data, ["choices"], 0, 2)!;
    expect((moved.choices as { id: string }[]).map((item) => item.id)).toEqual([ids[1], ids[2], ids[0], ids[3], ids[4]]);
    expect(listMove(data, ["choices"], 0, -1)).toBeNull();

    const removed = listRemove(line, data, ["choices"], 1)!;
    expect((removed.choices as { id: string }[]).map((item) => item.id)).toEqual([ids[0], ids[2], ids[3], ids[4]]);
  });
});

describe("matrix", () => {
  const cells = (data: NodeData) => data.cells as MatrixValue;

  it("follows its count and list dimensions and keeps values by key", () => {
    const grid = schema("test.grid");
    let data = reconcileData(grid, { columns: [{ id: "c1" }, { id: "c2" }], rows: 2, cells: {} });
    expect(cells(data)).toEqual({ 0: { c1: false, c2: false }, 1: { c1: false, c2: false } });

    data = reconcileData(grid, setIn(data, ["cells", "1", "c2"], true));
    // reordering columns keeps the checked cell on its column
    data = reconcileData(grid, listMove(data, ["columns"], 1, -1)!);
    expect(cells(data)["1"].c2).toBe(true);
    // removing the other column and shrinking rows drops only their cells
    data = reconcileData(grid, listRemove(grid, data, ["columns"], 1)!);
    expect(cells(data)).toEqual({ 0: { c2: false }, 1: { c2: true } });
    data = reconcileData(grid, { ...data, rows: 1 });
    expect(cells(data)).toEqual({ 0: { c2: false } });
  });

  it("is created with default dimensions", () => {
    const node = graph.addNode("test.grid", at);
    expect(node.data.cells).toEqual({ 0: {}, 1: {} });
  });
});

describe("item references", () => {
  const addLine = (name: string, texts: string[]) => {
    const line = graph.addNode("test.line", at);
    graph.renameNode(line.id, name);
    graph.setNodeData(line.id, { ...line.data, choices: texts.map((text, index) => ({ id: `${name}-${index}`, text, extra: false })) });
    return line;
  };

  it("finds elements by GUID and labels them with the list itemLabel", () => {
    addLine("1.1", ["Yes", "No"]);
    expect(itemRefLabel(graph, "1.1-1")).toBe("1.1 → Choice 2: No");
    expect(itemRefLabel(graph, "missing")).toBeNull();

    const field = schema("test.picker").fields[0] as ItemRefField;
    addLine("1.2", ["Maybe"]);
    expect(itemRefCandidates(graph, field).map((option) => option.label)).toEqual([
      "1.1 → Choice 1: Yes",
      "1.1 → Choice 2: No",
      "1.2 → Choice 1: Maybe",
    ]);
  });

  it("updates lookups after edits, removal and undo-like re-adding", () => {
    const line = addLine("1.1", ["Yes"]);
    graph.setNodeData(line.id, { ...line.data, choices: [{ id: "1.1-0", text: "Sure", extra: false }] });
    expect(itemRefLabel(graph, "1.1-0")).toBe("1.1 → Choice 1: Sure");
    graph.removeNode(line.id);
    expect(itemRefLabel(graph, "1.1-0")).toBeNull();
    graph.addNode(line, at);
    expect(itemRefLabel(graph, "1.1-0")).not.toBeNull();
  });

  it("pastes references to copied elements as references to the copies", () => {
    const line = addLine("1.1", ["Yes"]);
    const inside = graph.addNode("test.picker", at);
    graph.setNodeData(inside.id, { choice: "1.1-0" });
    const outside = graph.addNode("test.picker", at);
    graph.setNodeData(outside.id, { choice: "1.1-0" });

    const [lineCopy, insideCopy] = pasteNodes(graph, copyNodes(graph, [line.id, inside.id])!, at).map((id) => graph.getNode(id)!);
    const copiedChoice = (lineCopy.data.choices as { id: string }[])[0].id;
    expect(insideCopy.data.choice).toBe(copiedChoice);

    const [outsideCopy] = pasteNodes(graph, copyNodes(graph, [outside.id])!, at).map((id) => graph.getNode(id)!);
    expect(outsideCopy.data.choice).toBe("1.1-0");
  });

  it("remaps matrix keys of pasted nodes", () => {
    const grid = graph.addNode("test.grid", at);
    const data = reconcileData(grid.schema!, { ...grid.data, columns: [{ id: "c1", name: "" }] });
    graph.setNodeData(grid.id, setIn(data, ["cells", "0", "c1"], true));

    const [copy] = pasteNodes(graph, copyNodes(graph, [grid.id])!, at).map((id) => graph.getNode(id)!);
    const column = (copy.data.columns as { id: string }[])[0].id;
    expect(column).not.toBe("c1");
    expect((copy.data.cells as MatrixValue)["0"]).toEqual({ [column]: true });
  });
});

describe("node references", () => {
  it("lists nodes of the target schema by display name", () => {
    const b = graph.addNode("test.line", at);
    graph.renameNode(b.id, "1.2");
    const a = graph.addNode("test.line", at);
    graph.renameNode(a.id, "1.1");
    graph.addNode("test.start", at);
    const field = schema("test.node-picker").fields[0] as NodeRefField;
    expect(nodeRefCandidates(graph, field)).toEqual([
      { value: a.id, label: "1.1" },
      { value: b.id, label: "1.2" },
    ]);
  });

  it("pastes references to copied nodes as references to the copies", () => {
    const line = graph.addNode("test.line", at);
    const picker = graph.addNode("test.node-picker", at);
    graph.setNodeData(picker.id, { target: line.id });

    const [lineCopy, pickerCopy] = pasteNodes(graph, copyNodes(graph, [line.id, picker.id])!, at).map((id) => graph.getNode(id)!);
    expect(pickerCopy.data.target).toBe(lineCopy.id);

    const [alone] = pasteNodes(graph, copyNodes(graph, [picker.id])!, at).map((id) => graph.getNode(id)!);
    expect(alone.data.target).toBe(line.id);
  });
});
