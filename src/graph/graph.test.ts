import { beforeEach, describe, expect, it } from "vitest";
import { GraphModel, type GraphChange } from "./graph";
import { createSampleRegistry, type NumberState } from "./samples";
import { GraphJsonSerializer } from "./serializer";
import type { NodeGraphRegistry } from "./registry";

let registry: NodeGraphRegistry;

beforeEach(() => {
  registry = createSampleRegistry();
});

const at = (x: number, y = 0) => ({ x, y });

describe("GraphModel", () => {
  it("connects a derived type to a base input", () => {
    const graph = new GraphModel(registry);
    const source = graph.addNode("sample.derived-source", at(0));
    const sink = graph.addNode("sample.base-sink", at(100));

    const result = graph.connect(source.ports[0].id, sink.ports[0].id);

    expect(result.success).toBe(true);
    expect(graph.getOutputNodes(source.ports[0].id)).toEqual([sink]);
    expect(graph.getInputNodes(sink.ports[0].id)).toEqual([source]);
  });

  it("connects a derived type to an interface input", () => {
    const graph = new GraphModel(registry);
    const source = graph.addNode("sample.derived-source", at(0));
    const sink = graph.addNode("sample.interface-sink", at(100));

    expect(graph.connect(source.ports[0].id, sink.ports[0].id).success).toBe(true);
  });

  it("rejects a base type on a derived input", () => {
    const graph = new GraphModel(registry);
    const source = graph.addNode("sample.base-source", at(0));
    const sink = graph.addNode("sample.derived-sink", at(100));

    const result = graph.connect(source.ports[0].id, sink.ports[0].id);

    expect(result).toMatchObject({ success: false, reason: "IncompatibleTypes" });
  });

  it("rejects a second connection on a single input", () => {
    const graph = new GraphModel(registry);
    const first = graph.addNode("sample.number", at(0));
    const second = graph.addNode("sample.number", at(100));
    const sink = graph.addNode("sample.sink", at(200));
    const input = sink.ports[0].id;

    expect(graph.connect(first.ports[0].id, input).success).toBe(true);
    expect(graph.connect(second.ports[0].id, input)).toMatchObject({ success: false, reason: "InputCapacityReached" });
    expect(graph.getInputNodes(input)).toEqual([first]);
  });

  it("rejects wrong direction and duplicates", () => {
    const graph = new GraphModel(registry);
    const number = graph.addNode("sample.number", at(0));
    const add = graph.addNode("sample.add", at(100));

    expect(graph.connect(add.getPort("a")!.id, number.ports[0].id)).toMatchObject({ reason: "WrongDirection" });
    expect(graph.connect(number.ports[0].id, add.getPort("a")!.id).success).toBe(true);
    expect(graph.connect(number.ports[0].id, add.getPort("b")!.id).success).toBe(true);
  });

  it("removes connections together with a node", () => {
    const graph = new GraphModel(registry);
    const number = graph.addNode("sample.number", at(0));
    const sink = graph.addNode("sample.sink", at(100));
    graph.connect(number.ports[0].id, sink.ports[0].id);

    const changes: GraphChange["kind"][] = [];
    graph.subscribe((change) => changes.push(change.kind));
    graph.removeNode(number.id);

    expect(graph.connectionCount).toBe(0);
    expect(graph.hasConnections(sink.ports[0].id)).toBe(false);
    expect(changes).toEqual(["connectionRemoved", "nodeRemoved"]);
  });

  it("adds dynamic ports and refuses to remove connected ones", () => {
    const graph = new GraphModel(registry);
    const dynamic = graph.addNode("sample.dynamic", at(0));
    const sink = graph.addNode("sample.sink", at(100));
    const port = graph.addDynamicPort(dynamic.id, { key: "output-2", direction: "Output", typeId: "system.float" });
    graph.connect(port.id, sink.ports[0].id);

    expect(dynamic.ports.map((p) => p.key)).toEqual(["output-1", "output-2"]);
    expect(graph.removeDynamicPort(port.id)).toBe(false);
    expect(graph.removeDynamicPort(dynamic.ports[0].id)).toBe(true);
  });

  it("emits a single reset for batched changes", () => {
    const graph = new GraphModel(registry);
    const changes: GraphChange["kind"][] = [];
    graph.subscribe((change) => changes.push(change.kind));

    graph.batch(() => {
      graph.addNode("sample.number", at(0));
      graph.addNode("sample.number", at(10));
    });

    expect(changes).toEqual(["reset"]);
  });
});

describe("GraphJsonSerializer", () => {
  it("round-trips state, ports and connections", () => {
    const graph = new GraphModel(registry);
    const number = graph.addNode("sample.number", at(10, 20));
    graph.setNodeState<NumberState>(number.id, { value: 42.5 });
    const dynamic = graph.addNode("sample.dynamic", at(0, 200));
    graph.addDynamicPort(dynamic.id, { key: "output-2", direction: "Output", typeId: "system.float" });
    const sink = graph.addNode("sample.sink", at(300, 20));
    expect(graph.connect(number.ports[0].id, sink.ports[0].id).success).toBe(true);
    graph.setViewport({ x: 5, y: 6, zoom: 1.5 });

    const serializer = new GraphJsonSerializer(registry);
    const loaded = serializer.deserialize(serializer.serialize(graph));

    expect(loaded.warnings).toEqual([]);
    expect(loaded.graph.id).toBe(graph.id);
    expect(loaded.graph.getNode(number.id)!.state).toEqual({ value: 42.5 });
    expect(loaded.graph.getNode(number.id)!.position).toEqual({ x: 10, y: 20 });
    expect(loaded.graph.getNode(dynamic.id)!.ports.map((p) => p.id)).toEqual(dynamic.ports.map((p) => p.id));
    expect(loaded.graph.connectionCount).toBe(1);
    expect(loaded.graph.viewport).toEqual({ x: 5, y: 6, zoom: 1.5 });
  });

  it("writes number state with the Unity-compatible key", () => {
    const graph = new GraphModel(registry);
    const number = graph.addNode("sample.number", at(0));
    graph.setNodeState<NumberState>(number.id, { value: 3 });

    const json = JSON.parse(new GraphJsonSerializer(registry).serialize(graph));

    expect(json.nodes[0].state).toEqual({ Value: 3 });
  });

  it("loads an unknown node as a placeholder and round-trips it", () => {
    const json = `{
      "format": "node-graph",
      "version": 1,
      "graphId": "11111111-1111-1111-1111-111111111111",
      "viewport": { "position": { "x": 0, "y": 0 }, "zoom": 1 },
      "nodes": [
        {
          "id": "22222222-2222-2222-2222-222222222222",
          "typeId": "missing.node",
          "position": { "x": 1, "y": 2 },
          "ports": [
            { "id": "33333333-3333-3333-3333-333333333333", "key": "out", "direction": "Output", "capacity": "Multiple", "typeId": "missing.type", "displayName": "Out", "isDynamic": true }
          ],
          "state": { "value": 10 }
        }
      ],
      "connections": [],
      "unresolvedConnections": []
    }`;

    const serializer = new GraphJsonSerializer(registry);
    const result = serializer.deserialize(json);
    const node = [...result.graph.nodes][0];

    expect(node.isPlaceholder).toBe(true);
    expect(result.warnings).toHaveLength(1);
    const roundTrip = serializer.serialize(result.graph);
    expect(roundTrip).toContain("missing.node");
    expect(roundTrip).toContain("missing.type");
    expect(JSON.parse(roundTrip).nodes[0].state).toEqual({ value: 10 });
  });

  it("keeps connections with missing endpoints as unresolved", () => {
    const graph = new GraphModel(registry);
    const number = graph.addNode("sample.number", at(0));
    const sink = graph.addNode("sample.sink", at(100));
    graph.connect(number.ports[0].id, sink.ports[0].id);
    const serializer = new GraphJsonSerializer(registry);
    const document = JSON.parse(serializer.serialize(graph));
    document.nodes = document.nodes.filter((n: { typeId: string }) => n.typeId !== "sample.sink");

    const result = serializer.deserialize(JSON.stringify(document));

    expect(result.graph.connectionCount).toBe(0);
    expect(result.graph.unresolvedConnections).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(JSON.parse(serializer.serialize(result.graph)).unresolvedConnections).toHaveLength(1);
  });

  it("falls back to a placeholder when static ports do not match the schema", () => {
    const graph = new GraphModel(registry);
    graph.addNode("sample.number", at(0));
    const serializer = new GraphJsonSerializer(registry);
    const document = JSON.parse(serializer.serialize(graph));
    document.nodes[0].ports[0].typeId = "system.int";

    const result = serializer.deserialize(JSON.stringify(document));

    expect([...result.graph.nodes][0].isPlaceholder).toBe(true);
    expect(result.warnings[0]).toContain("placeholder");
  });

  it("rejects unsupported formats", () => {
    const serializer = new GraphJsonSerializer(registry);
    expect(() => serializer.deserialize('{"format":"other","version":1}')).toThrow(/Unsupported graph format/);
    expect(() => serializer.deserialize("")).toThrow(/empty/);
  });
});
