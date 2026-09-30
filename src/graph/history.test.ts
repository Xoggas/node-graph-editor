import { beforeEach, describe, expect, it } from "vitest";
import { copyViews, pasteViews } from "./clipboard";
import { GraphModel } from "./graph";
import { GraphHistory } from "./history";
import { createTestRegistry } from "./testPack";

let graph: GraphModel;
let history: GraphHistory;

beforeEach(() => {
  graph = new GraphModel(createTestRegistry());
  history = new GraphHistory();
  history.attach(graph);
});

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const at = (x: number, y = 0) => ({ x, y });

describe("GraphHistory", () => {
  it("undoes and redoes node removal together with its connections", async () => {
    const start = graph.addNode("test.start", at(0));
    const line = graph.addNode("test.line", at(300));
    graph.connect(start.getPort("out")!.id, line.getPort("in")!.id);
    await tick();

    graph.removeNode(start.id);
    await tick();
    expect(graph.connectionCount).toBe(0);

    history.undo();
    expect(graph.getNode(start.id)).toBe(start);
    expect(graph.connectionCount).toBe(1);

    history.redo();
    expect(graph.getNode(start.id)).toBeUndefined();
    expect(graph.connectionCount).toBe(0);
  });

  it("groups changes of one task into one entry", async () => {
    graph.addNode("test.start", at(0));
    graph.addNode("test.line", at(10));
    await tick();

    history.undo();
    expect(graph.nodeCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it("coalesces a drag spanning several tasks into one move", async () => {
    const node = graph.addNode("test.start", at(0));
    await tick();

    history.begin();
    graph.moveNode(node.id, at(10));
    await tick();
    graph.moveNode(node.id, at(20, 5));
    await tick();
    history.end();

    history.undo();
    expect(node.position).toEqual(at(0));
    history.redo();
    expect(node.position).toEqual(at(20, 5));
  });

  it("restores removed list elements with their ports and connections", async () => {
    const line = graph.addNode("test.line", at(0));
    const target = graph.addNode("test.line", at(300));
    graph.setNodeData(line.id, { ...line.data, choices: [{ id: "c0", text: "Yes", extra: false }] });
    graph.connect(line.getPort("choice:c0")!.id, target.getPort("in")!.id);
    await tick();

    graph.setNodeData(line.id, { ...line.data, choices: [] });
    await tick();
    expect(graph.connectionCount).toBe(0);

    history.undo();
    expect((line.data.choices as unknown[]).length).toBe(1);
    expect(graph.connectionCount).toBe(1);
    expect(graph.hasConnections(line.getPort("choice:c0")!.id)).toBe(true);

    history.redo();
    expect(line.getPort("choice:c0")).toBeUndefined();
    expect(graph.connectionCount).toBe(0);
  });

  it("undoes renames", async () => {
    const line = graph.addNode("test.line", at(0));
    await tick();
    graph.renameNode(line.id, "1.1");
    await tick();
    history.undo();
    expect(line.name).toBe("");
  });

  it("drops the redo stack after a new change", async () => {
    graph.addNode("test.start", at(0));
    await tick();
    history.undo();
    graph.addNode("test.line", at(0));
    await tick();
    expect(history.canRedo).toBe(false);
  });
});

describe("clipboard", () => {
  it("pastes copies with fresh ids, remapped element ports, unique names and internal connections", () => {
    const line = graph.addNode("test.line", at(0));
    graph.renameNode(line.id, "1.1");
    graph.setNodeData(line.id, { ...line.data, text: "Hello", choices: [{ id: "c0", text: "Yes", extra: true }] });
    const target = graph.addNode("test.line", at(300));
    graph.connect(line.getPort("choice:c0")!.id, target.getPort("in")!.id);
    const outside = graph.addNode("test.line", at(600));
    graph.connect(target.getPort("next")!.id, outside.getPort("in")!.id);

    const data = copyViews(graph, [line.id, target.id])!;
    const [lineCopyId, targetCopyId] = pasteViews(graph, data, at(50, 50)).nodeIds;

    const lineCopy = graph.getNode(lineCopyId)!;
    const choice = (lineCopy.data.choices as { id: string; text: string; extra: boolean }[])[0];
    expect(lineCopy.name).toBe("1.1 2");
    expect(lineCopy.data.text).toBe("Hello");
    expect(choice).toMatchObject({ text: "Yes", extra: true });
    expect(choice.id).not.toBe("c0");
    expect(lineCopy.position).toEqual(at(50, 50));

    const copiedChoicePort = lineCopy.getPort(`choice:${choice.id}`)!;
    const [connection] = graph.getPortConnections(copiedChoicePort.id);
    expect(connection.inputNodeId).toBe(targetCopyId);
    // the connection to the node outside the selection is not copied
    expect(graph.connectionCount).toBe(3);
  });
});
