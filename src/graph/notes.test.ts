import { beforeEach, describe, expect, it } from "vitest";
import { copyViews, pasteViews } from "./clipboard";
import { exportRuntimeGraph } from "./export";
import { GraphModel } from "./graph";
import { GraphHistory } from "./history";
import { GraphJsonSerializer } from "./serializer";
import { createTestRegistry } from "./testPack";
import { NOTE_MIN_SIZE } from "./types";

let graph: GraphModel;
let history: GraphHistory;

beforeEach(() => {
  graph = new GraphModel(createTestRegistry());
  history = new GraphHistory();
  history.attach(graph);
});

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("sticky notes", () => {
  it("are added, moved, edited and removed as views, with undo", async () => {
    const note = graph.addNote({ x: 10, y: 20 }, { text: "Check this branch" });
    await tick();
    expect(graph.viewPosition(note.id)).toEqual({ x: 10, y: 20 });
    expect(graph.viewNode(note.id)).toBeUndefined();

    graph.moveView(note.id, { x: 50, y: 60 });
    await tick();
    graph.updateNote(note.id, { text: "Done", color: "green" });
    await tick();
    expect(note).toMatchObject({ text: "Done", color: "green", position: { x: 50, y: 60 } });

    history.undo();
    expect(note).toMatchObject({ text: "Check this branch", color: "yellow" });
    history.undo();
    expect(note.position).toEqual({ x: 10, y: 20 });

    graph.removeView(note.id);
    await tick();
    expect(graph.getNote(note.id)).toBeUndefined();
    history.undo();
    expect(graph.getNote(note.id)).toBe(note);
  });

  it("resizing in one interaction is one undo step, clamped to the minimum size", async () => {
    const note = graph.addNote({ x: 0, y: 0 });
    await tick();
    const before = { ...note.size };
    history.begin();
    graph.updateNote(note.id, { size: { width: 300, height: 200 } });
    graph.updateNote(note.id, { size: { width: 10, height: 10 } });
    history.end();
    expect(note.size).toEqual(NOTE_MIN_SIZE);
    history.undo();
    expect(note.size).toEqual(before);
    history.redo();
    expect(note.size).toEqual(NOTE_MIN_SIZE);
  });

  it("are saved with the graph but not exported for the game", () => {
    const note = graph.addNote({ x: 5, y: 6 }, { text: "Hello\nworld", color: "blue", size: { width: 300, height: 180 } });
    const serializer = new GraphJsonSerializer(graph.registry);
    const loaded = serializer.deserialize(serializer.serialize(graph)).graph;
    expect(loaded.getNote(note.id)).toEqual(note);
    expect(JSON.stringify(exportRuntimeGraph(graph).graph)).not.toContain("Hello");
  });

  it("are copied and pasted with the selection", () => {
    const line = graph.addNode("test.line", { x: 0, y: 0 });
    const note = graph.addNote({ x: 100, y: 0 }, { text: "Why", color: "pink" });
    const data = copyViews(graph, [line.id, note.id])!;
    const { viewIds } = pasteViews(graph, data, { x: 0, y: 200 });
    const pasted = viewIds.map((id) => graph.getNote(id)).find((candidate) => candidate)!;
    expect(pasted.id).not.toBe(note.id);
    expect(pasted).toMatchObject({ text: "Why", color: "pink", position: { x: 100, y: 200 } });
  });
});
