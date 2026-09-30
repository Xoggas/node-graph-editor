import { beforeEach, describe, expect, it } from "vitest";
import { copyViews, pasteViews } from "./clipboard";
import { exportRuntimeGraph } from "./export";
import { GraphModel } from "./graph";
import { GraphHistory } from "./history";
import { GraphJsonSerializer } from "./serializer";
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

/** start → line, with the connection drawn at a linked copy of `line`. */
function linkedSetup() {
  const start = graph.addNode("test.start", at(0));
  const line = graph.addNode("test.line", at(300));
  const alias = graph.addAlias(line.id, at(900, 400));
  const result = graph.connect(start.getPort("out")!.id, line.getPort("in")!.id, undefined, { input: alias.id });
  if (!result.success) throw new Error(result.message);
  return { start, line, alias, connection: result.connection };
}

describe("linked copies", () => {
  it("share the node's data and id, but each view has connections of its own", () => {
    const { start, line, alias, connection } = linkedSetup();
    expect(connection).toMatchObject({ inputNodeId: line.id, inputViewId: alias.id, outputViewId: start.id });
    expect(graph.viewNode(alias.id)).toBe(line);
    expect(graph.viewIdsOf(line.id)).toEqual([line.id, alias.id]);
    // The same input at another view is a different place: it takes its own connections...
    const other = graph.addNode("test.line", at(0, 300));
    expect(graph.connect(other.getPort("next")!.id, line.getPort("in")!.id).success).toBe(true);
    // ...but the same view pair twice is a duplicate.
    const again = graph.connect(start.getPort("out")!.id, line.getPort("in")!.id, undefined, { input: alias.id });
    expect(again.success ? null : again.reason).toBe("DuplicateConnection");
  });

  it("count single capacity per view", () => {
    const { line, alias } = linkedSetup();
    const next = line.getPort("next")!;
    const targets = [0, 1, 2].map((i) => graph.addNode("test.line", at(1200, i * 200)));
    graph.connect(next.id, targets[0].getPort("in")!.id);
    graph.connect(next.id, targets[1].getPort("in")!.id, undefined, { output: alias.id });
    const views = [...graph.getPortConnections(next.id)].map((connection) => connection.outputViewId).sort();
    expect(views).toEqual([alias.id, line.id].sort());
  });

  it("ignores a view that is not a copy of the port's node", () => {
    const { start, line } = linkedSetup();
    const stranger = graph.addAlias(start.id, at(0, 500));
    graph.disconnect([...graph.connections][0].id);
    const result = graph.connect(start.getPort("out")!.id, line.getPort("in")!.id, undefined, { input: stranger.id });
    expect(result.success && result.connection.inputViewId).toBe(line.id);
  });

  it("removing a copy removes only the connections drawn at it; undo restores both", async () => {
    const { start, line, alias } = linkedSetup();
    const direct = graph.addNode("test.line", at(300, 300));
    graph.connect(line.getPort("next")!.id, direct.getPort("in")!.id);
    await tick();

    graph.removeAlias(alias.id);
    await tick();
    expect(graph.getAlias(alias.id)).toBeUndefined();
    expect(graph.connectionCount).toBe(1);

    history.undo();
    expect(graph.getAlias(alias.id)).toBe(alias);
    const restored = [...graph.getPortConnections(start.getPort("out")!.id)][0];
    expect(restored.inputViewId).toBe(alias.id);
  });

  it("removing the node removes its copies; undo brings everything back", async () => {
    const { line, alias } = linkedSetup();
    await tick();
    graph.removeNode(line.id);
    await tick();
    expect(graph.getAlias(alias.id)).toBeUndefined();
    expect(graph.connectionCount).toBe(0);

    history.undo();
    expect(graph.aliasesOf(line.id)).toEqual([alias]);
    expect([...graph.connections][0].inputViewId).toBe(alias.id);
  });

  it("moves are undoable", async () => {
    const { alias } = linkedSetup();
    await tick();
    graph.moveView(alias.id, at(10, 10));
    graph.moveView(alias.id, at(20, 20));
    await tick();
    history.undo();
    expect(alias.position).toEqual(at(900, 400));
  });

  it("round-trip through the document format", () => {
    const { line, alias } = linkedSetup();
    const serializer = new GraphJsonSerializer(graph.registry);
    const json = serializer.serialize(graph);
    const document = JSON.parse(json);
    expect(document.aliases).toEqual([{ id: alias.id, node: line.id, position: at(900, 400) }]);
    expect(document.connections[0].to).toEqual({ node: line.id, port: "in", view: alias.id });
    expect(document.connections[0].from.view).toBeUndefined();

    const { graph: loaded, warnings } = serializer.deserialize(json);
    expect(warnings).toEqual([]);
    expect(loaded.getAlias(alias.id)).toMatchObject({ nodeId: line.id, position: at(900, 400) });
    expect([...loaded.connections][0].inputViewId).toBe(alias.id);
  });

  it("export as aliases of the node with their own connections", () => {
    const { start, line, alias } = linkedSetup();
    const end = graph.addNode("test.line", at(1200));
    graph.connect(line.getPort("next")!.id, end.getPort("in")!.id, undefined, { output: alias.id });
    const runtime = exportRuntimeGraph(graph).graph;
    expect(Object.keys(runtime.nodes).sort()).toEqual([start.id, line.id, end.id].sort());
    expect(runtime.nodes[start.id].outputs).toEqual({ out: [alias.id] });
    expect(runtime.nodes[line.id].inputs).toBeUndefined();
    expect(runtime.aliases).toEqual({ [alias.id]: { node: line.id, inputs: { in: [start.id] }, outputs: { next: [end.id] } } });
    expect(runtime.nodes[end.id].inputs).toEqual({ in: [alias.id] });
  });

  it("paste: with its node the copy links to the pasted node, alone it links to the same node", () => {
    const { start, line, alias } = linkedSetup();

    const withNode = pasteViews(graph, copyViews(graph, [start.id, line.id, alias.id])!, at(0, 1000));
    const [startCopy, lineCopy, aliasCopy] = withNode.viewIds;
    expect(withNode.nodeIds).toEqual([startCopy, lineCopy]);
    expect(graph.getAlias(aliasCopy)!.nodeId).toBe(lineCopy);
    const pasted = [...graph.getPortConnections(graph.getNode(startCopy)!.getPort("out")!.id)][0];
    expect(pasted).toMatchObject({ inputNodeId: lineCopy, inputViewId: aliasCopy });

    const alone = pasteViews(graph, copyViews(graph, [alias.id])!, at(0, 2000));
    expect(alone.nodeIds).toEqual([]);
    expect(graph.getAlias(alone.viewIds[0])!.nodeId).toBe(line.id);
  });
});
