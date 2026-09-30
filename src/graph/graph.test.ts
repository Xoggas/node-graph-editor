import { beforeEach, describe, expect, it } from "vitest";
import { type GraphChange, GraphModel } from "./graph";
import type { SchemaRegistry } from "./registry";
import { GraphJsonSerializer } from "./serializer";
import { createTestRegistry } from "./testPack";

let registry: SchemaRegistry;
let graph: GraphModel;

beforeEach(() => {
  registry = createTestRegistry();
  graph = new GraphModel(registry);
});

const at = (x: number, y = 0) => ({ x, y });
const lineWithChoices = (...texts: string[]) => {
  const node = graph.addNode("test.line", at(0));
  graph.setNodeData(node.id, { ...node.data, choices: texts.map((text, index) => ({ id: `c${index}`, text, extra: false })) });
  return node;
};

describe("GraphModel", () => {
  it("connects compatible port types, including inherited ones", () => {
    const source = graph.addNode("test.int-source", at(0));
    const sink = graph.addNode("test.number-sink", at(100));
    expect(graph.connect(source.ports[0].id, sink.ports[0].id).success).toBe(true);

    const compare = graph.addNode("test.compare", at(0));
    const line = graph.addNode("test.line", at(100));
    expect(graph.connect(compare.getPort("result")!.id, line.getPort("in")!.id)).toMatchObject({
      success: false,
      reason: "IncompatibleTypes",
    });
  });

  it("takes default capacities from the port type", () => {
    const start = graph.addNode("test.start", at(0));
    const a = graph.addNode("test.line", at(100));
    const b = graph.addNode("test.line", at(100, 200));
    const c = graph.addNode("test.line", at(400));

    // flow outputs are single: a branch cannot fan out
    expect(graph.connect(start.getPort("out")!.id, a.getPort("in")!.id).success).toBe(true);
    expect(graph.connect(start.getPort("out")!.id, b.getPort("in")!.id)).toMatchObject({ reason: "OutputCapacityReached" });
    // flow inputs are multiple: branches can merge
    expect(graph.connect(a.getPort("next")!.id, c.getPort("in")!.id).success).toBe(true);
    expect(graph.connect(b.getPort("next")!.id, c.getPort("in")!.id).success).toBe(true);
  });

  it("re-derives ports when data changes and disconnects removed ones", () => {
    const line = lineWithChoices("Yes", "No");
    const target = graph.addNode("test.line", at(300));
    graph.connect(line.getPort("choice:c1")!.id, target.getPort("in")!.id);

    const changes: GraphChange["kind"][] = [];
    graph.subscribe((change) => changes.push(change.kind));
    graph.setNodeData(line.id, { ...line.data, choices: [(line.data.choices as unknown[])[0]] });

    expect(line.ports.map((port) => port.key)).toEqual(["in", "condition:c0", "choice:c0", "next"]);
    expect(graph.getPort(`${line.id}/choice:c1`)).toBeUndefined();
    expect(graph.connectionCount).toBe(0);
    expect(changes).toEqual(["connectionRemoved", "nodeDataChanged", "nodePortsChanged"]);
  });

  it("keeps connections when list elements are reordered", () => {
    const line = lineWithChoices("Yes", "No");
    const target = graph.addNode("test.line", at(300));
    graph.connect(line.getPort("choice:c1")!.id, target.getPort("in")!.id);

    const [first, second] = line.data.choices as unknown[];
    graph.setNodeData(line.id, { ...line.data, choices: [second, first] });

    expect(graph.connectionCount).toBe(1);
    expect(line.outputs.map((port) => port.key)).toEqual(["choice:c1", "choice:c0", "next"]);
  });

  it("updates port labels when element text changes", () => {
    const line = lineWithChoices("Yes");
    graph.setNodeData(line.id, { ...line.data, choices: [{ id: "c0", text: "Sure", extra: false }] });
    expect(line.getPort("choice:c0")!.displayName).toBe("Sure");
  });
});

describe("GraphJsonSerializer", () => {
  it("round-trips schema ids, names, data, repeated-port connections and viewport", () => {
    const line = lineWithChoices("Yes", "No");
    graph.renameNode(line.id, "1.1");
    const target = graph.addNode("test.line", at(300));
    graph.connect(line.getPort("choice:c1")!.id, target.getPort("in")!.id);
    graph.setViewport({ x: 5, y: 6, zoom: 1.5 });

    const serializer = new GraphJsonSerializer(registry);
    const json = serializer.serialize(graph);
    const document = JSON.parse(json);
    expect(document.pack).toEqual({ id: "test", version: 1 });
    expect(document.nodes[0]).toMatchObject({ schema: "test.line", schemaVersion: 1, name: "1.1" });
    expect(document.connections[0]).toMatchObject({ from: { node: line.id, port: "choice:c1" }, to: { node: target.id, port: "in" } });

    const loaded = serializer.deserialize(json);
    expect(loaded.warnings).toEqual([]);
    const loadedLine = loaded.graph.getNode(line.id)!;
    expect(loadedLine.name).toBe("1.1");
    expect(loadedLine.data).toEqual(line.data);
    expect(loaded.graph.connectionCount).toBe(1);
    expect(loaded.graph.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });

  it("loads unknown schemas as placeholders that keep data and connections", () => {
    const serializer = new GraphJsonSerializer(registry);
    const start = graph.addNode("test.start", at(0));
    const line = graph.addNode("test.line", at(200));
    graph.connect(start.getPort("out")!.id, line.getPort("in")!.id);
    const document = JSON.parse(serializer.serialize(graph));
    document.nodes[1].schema = "missing.node";
    document.nodes[1].data = { anything: [1, 2, 3] };

    const result = serializer.deserialize(JSON.stringify(document));
    const placeholder = result.graph.getNode(line.id)!;
    expect(placeholder.isPlaceholder).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.graph.connectionCount).toBe(1);

    const roundTrip = JSON.parse(serializer.serialize(result.graph));
    expect(roundTrip.nodes[1]).toMatchObject({ schema: "missing.node", data: { anything: [1, 2, 3] } });
    expect(roundTrip.connections).toHaveLength(1);
  });

  it("keeps connections to ports that no longer exist as unresolved", () => {
    const serializer = new GraphJsonSerializer(registry);
    const matrix = graph.addNode("test.matrix", at(0));
    const target = graph.addNode("test.line", at(300));
    graph.connect(matrix.getPort("outcome:1")!.id, target.getPort("in")!.id);
    const document = JSON.parse(serializer.serialize(graph));
    document.nodes[0].data.outcomes = 1;

    const result = serializer.deserialize(JSON.stringify(document));
    expect(result.graph.connectionCount).toBe(0);
    expect(result.graph.unresolvedConnections[0].reason).toContain("'outcome:1' does not exist");
    expect(JSON.parse(serializer.serialize(result.graph)).unresolvedConnections).toHaveLength(1);
  });

  it("warns about invalid data and a different pack", () => {
    const serializer = new GraphJsonSerializer(registry);
    graph.addNode("test.matrix", at(0));
    const document = JSON.parse(serializer.serialize(graph));
    document.pack.id = "other";
    document.nodes[0].data.outcomes = "lots";

    const result = serializer.deserialize(JSON.stringify(document));
    expect(result.warnings).toHaveLength(2);
    expect([...result.graph.nodes][0].data.outcomes).toBe(2);
  });

  it("rejects unsupported formats", () => {
    const serializer = new GraphJsonSerializer(registry);
    expect(() => serializer.deserialize('{"format":"other","version":2}')).toThrow(/Unsupported graph format/);
    expect(() => serializer.deserialize('{"format":"node-graph","version":1}')).toThrow(/version '1'/);
    expect(() => serializer.deserialize("")).toThrow(/empty/);
  });
});
