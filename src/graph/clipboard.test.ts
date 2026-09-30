import { describe, expect, it } from "vitest";
import { copyViews, linkCopiedNodes, pasteViews } from "./clipboard";
import { GraphModel } from "./graph";
import { createTestRegistry } from "./testPack";

describe("linkCopiedNodes", () => {
  it("pastes the chosen nodes as linked copies of their originals, keeping the connections", () => {
    const graph = new GraphModel(createTestRegistry());
    const start = graph.addNode("test.start", { x: 0, y: 0 });
    const line = graph.addNode("test.line", { x: 300, y: 0 });
    graph.connect(start.getPort("out")!.id, line.getPort("in")!.id);

    const data = linkCopiedNodes(copyViews(graph, [start.id, line.id])!, new Set([line.id]));
    const { nodeIds, viewIds } = pasteViews(graph, data, { x: 0, y: 200 });

    expect(nodeIds).toHaveLength(1);
    const alias = viewIds.map((id) => graph.getAlias(id)).find((candidate) => candidate)!;
    expect(alias).toMatchObject({ nodeId: line.id, position: { x: 300, y: 200 } });
    const pasted = [...graph.getPortConnections(graph.getNode(nodeIds[0])!.getPort("out")!.id)];
    expect(pasted).toHaveLength(1);
    expect(pasted[0]).toMatchObject({ inputNodeId: line.id, inputViewId: alias.id });
  });
});
