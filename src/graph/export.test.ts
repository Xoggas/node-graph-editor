import { describe, expect, it } from "vitest";
import { exportRuntimeGraph } from "./export";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";

const registry = () =>
  new SchemaRegistry(
    parseSchemaPack([
      {
        path: "pack.json",
        text: JSON.stringify({
          id: "game",
          portTypes: { flow: { capacity: { input: "multiple", output: "single" } }, bool: {} },
          export: { entry: "start" },
        }),
      },
      {
        path: "nodes/n.json",
        text: JSON.stringify([
          { id: "start", title: "Start", ports: [{ id: "out", direction: "output", type: "flow" }] },
          {
            id: "line",
            title: "Line",
            meta: { nodeType: "Blocking" },
            ports: [
              { id: "in", direction: "input", type: "flow" },
              { id: "condition", direction: "input", type: "bool" },
              { id: "next", direction: "output", type: "flow" },
            ],
            fields: [
              { id: "text", type: "localizedText", keyFrom: "name" },
              { id: "other", type: "nodeRef", schema: "line" },
            ],
          },
          { id: "flag", title: "Flag", ports: [{ id: "result", direction: "output", type: "bool" }] },
        ]),
      },
    ]),
  );

describe("exportRuntimeGraph", () => {
  it("keeps only what the engine needs and resolves keys and connections", () => {
    const graph = new GraphModel(registry());
    const start = graph.addNode("start", { x: 10, y: 20 });
    const line = graph.addNode("line", { x: 300, y: 20 });
    const second = graph.addNode("line", { x: 600, y: 20 });
    const flag = graph.addNode("flag", { x: 0, y: 200 });
    graph.renameNode(line.id, "1.1");
    graph.renameNode(second.id, "1.2");
    graph.setNodeData(second.id, { ...second.data, text: "custom.key", other: line.id });
    graph.connect(start.getPort("out")!.id, line.getPort("in")!.id);
    graph.connect(line.getPort("next")!.id, second.getPort("in")!.id);
    graph.connect(flag.getPort("result")!.id, line.getPort("condition")!.id);

    const { graph: runtime, warnings } = exportRuntimeGraph(graph);

    expect(warnings).toEqual([]);
    expect(runtime).toMatchObject({ format: "node-graph-runtime", version: 1, graph: graph.id, pack: "game", entry: start.id });
    expect(runtime.types).toEqual({ line: { nodeType: "Blocking" } });
    expect(runtime.nodes[start.id]).toEqual({ type: "start", data: {}, outputs: { out: [line.id] } });
    expect(runtime.nodes[line.id]).toEqual({
      type: "line",
      data: { text: "1.1", other: null },
      inputs: { in: [start.id], condition: [flag.id] },
      outputs: { next: [second.id] },
    });
    expect(runtime.nodes[second.id].data).toEqual({ text: "custom.key", other: line.id });
    expect(runtime.nodes[second.id].outputs).toBeUndefined();

    const json = JSON.stringify(runtime);
    for (const editorOnly of ["position", "viewport", "schemaVersion", "\"name\"", "connections"]) {
      expect(json).not.toContain(editorOnly);
    }
  });

  it("warns about a missing start node, unnamed texts and dangling references", () => {
    const graph = new GraphModel(registry());
    const line = graph.addNode("line", { x: 0, y: 0 });
    const target = graph.addNode("line", { x: 0, y: 0 });
    graph.setNodeData(line.id, { ...line.data, other: target.id });
    graph.removeNode(target.id);

    const { graph: runtime, warnings } = exportRuntimeGraph(graph);

    expect(runtime.entry).toBeUndefined();
    expect(warnings).toEqual([
      "'Line' → Text: no localization key (the node has no name).",
      "'Line' → Other: the referenced node was deleted.",
      "There is no 'Start' node to start from.",
    ]);
  });
});
