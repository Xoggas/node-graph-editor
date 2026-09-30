import { beforeEach, describe, expect, it } from "vitest";
import { copyNodes, pasteNodes } from "./clipboard";
import { GraphModel } from "./graph";
import { GraphHistory } from "./history";
import { createSampleRegistry, type NumberState } from "./samples";

let graph: GraphModel;
let history: GraphHistory;

beforeEach(() => {
  graph = new GraphModel(createSampleRegistry());
  history = new GraphHistory();
  history.attach(graph);
});

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("GraphHistory", () => {
  it("undoes and redoes node removal together with its connections", async () => {
    const number = graph.addNode("sample.number", { x: 0, y: 0 });
    const sink = graph.addNode("sample.sink", { x: 300, y: 0 });
    const connection = graph.connect(number.ports[0].id, sink.ports[0].id);
    await tick();

    graph.removeNode(number.id);
    await tick();
    expect(graph.connectionCount).toBe(0);

    expect(history.undo()).toBe(true);
    expect(graph.getNode(number.id)).toBe(number);
    expect(graph.connectionCount).toBe(1);
    expect(connection.success && graph.getConnection(connection.connection.id)).toBeTruthy();

    expect(history.redo()).toBe(true);
    expect(graph.getNode(number.id)).toBeUndefined();
    expect(graph.connectionCount).toBe(0);
  });

  it("groups changes of one task into one entry", async () => {
    graph.addNode("sample.number", { x: 0, y: 0 });
    graph.addNode("sample.number", { x: 10, y: 0 });
    await tick();

    history.undo();
    expect(graph.nodeCount).toBe(0);
    expect(history.canUndo).toBe(false);
  });

  it("coalesces a drag spanning several tasks into one move", async () => {
    const node = graph.addNode("sample.number", { x: 0, y: 0 });
    await tick();

    history.begin();
    graph.moveNode(node.id, { x: 10, y: 0 });
    await tick();
    graph.moveNode(node.id, { x: 20, y: 5 });
    await tick();
    history.end();

    history.undo();
    expect(node.position).toEqual({ x: 0, y: 0 });
    history.redo();
    expect(node.position).toEqual({ x: 20, y: 5 });
  });

  it("undoes state edits and dynamic ports", async () => {
    const number = graph.addNode("sample.number", { x: 0, y: 0 });
    const dynamic = graph.addNode("sample.dynamic", { x: 0, y: 200 });
    await tick();

    graph.setNodeState<NumberState>(number.id, { value: 5 });
    graph.addDynamicPort(dynamic.id, { key: "output-2", direction: "Output", typeId: "system.float" });
    await tick();

    history.undo();
    expect(number.state).toEqual({ value: 0 });
    expect(dynamic.ports).toHaveLength(1);
    expect(graph.getPort(dynamic.ports[0].id)).toBeDefined();

    history.redo();
    expect(number.state).toEqual({ value: 5 });
    expect(dynamic.ports).toHaveLength(2);
    expect(graph.getPort(dynamic.ports[1].id)).toBeDefined();
  });

  it("drops the redo stack after a new change", async () => {
    graph.addNode("sample.number", { x: 0, y: 0 });
    await tick();
    history.undo();
    graph.addNode("sample.sink", { x: 0, y: 0 });
    await tick();
    expect(history.canRedo).toBe(false);
  });
});

describe("clipboard", () => {
  it("pastes copies with fresh ids, dynamic ports, state and internal connections", () => {
    const number = graph.addNode("sample.number", { x: 0, y: 0 });
    graph.setNodeState<NumberState>(number.id, { value: 7 });
    const dynamic = graph.addNode("sample.dynamic", { x: 0, y: 200 });
    const port = graph.addDynamicPort(dynamic.id, { key: "output-2", direction: "Output", typeId: "system.float" });
    const add = graph.addNode("sample.add", { x: 300, y: 0 });
    graph.connect(number.ports[0].id, add.getPort("a")!.id);
    graph.connect(port.id, add.getPort("b")!.id);
    const outside = graph.addNode("sample.sink", { x: 600, y: 0 });
    graph.connect(add.getPort("result")!.id, outside.ports[0].id);

    const data = copyNodes(graph, [number.id, dynamic.id, add.id])!;
    const ids = pasteNodes(graph, data, { x: 50, y: 50 });

    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(number.id);
    const [numberCopy, dynamicCopy, addCopy] = ids.map((id) => graph.getNode(id)!);
    expect(numberCopy.state).toEqual({ value: 7 });
    expect(numberCopy.position).toEqual({ x: 50, y: 50 });
    expect(dynamicCopy.ports.map((p) => p.key)).toEqual(["output-1", "output-2"]);
    expect(dynamicCopy.ports[1].id).not.toBe(port.id);
    expect(graph.getNodeConnections(addCopy.id)).toHaveLength(2);
    expect(graph.connectionCount).toBe(5);
  });
});
