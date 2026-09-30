import { describe, expect, it } from "vitest";
import { choiceLinks, choiceRouteConnections } from "./choices";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";

const flowNode = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  ports: [
    { id: "in", direction: "input", type: "flow" },
    { id: "out", direction: "output", type: "flow", capacity: "multiple" },
  ],
  ...extra,
});

const registry = new SchemaRegistry(
  parseSchemaPack([
    { path: "pack.json", text: JSON.stringify({ id: "c", portTypes: { flow: { required: ["input", "output"] } } }) },
    {
      path: "nodes/n.json",
      text: JSON.stringify([
        flowNode("line", { blocking: true }),
        flowNode("choice", { blocking: true, choice: true }),
        flowNode("matrix"),
        flowNode("sound"),
      ]),
    },
  ]),
);

const at = (x: number, y = 0) => ({ x, y });

function build() {
  const graph = new GraphModel(registry);
  const add = (schema: string, x: number, y = 0) => graph.addNode(schema, at(x, y));
  const link = (a: { getPort(key: string): { id: string } | undefined }, b: { getPort(key: string): { id: string } | undefined }, views = {}) =>
    graph.connect(a.getPort("out")!.id, b.getPort("in")!.id, undefined, views);
  return { graph, add, link };
}

describe("choiceLinks", () => {
  it("links a line to choices through non-blocking nodes, and marks direct ones", () => {
    const { graph, add, link } = build();
    const line = add("line", 0);
    const matrix = add("matrix", 200);
    const sound = add("sound", 400);
    const direct = add("choice", 200, 300);
    const deferred = add("choice", 600);
    const after = add("line", 800);
    const beyond = add("choice", 1000);
    link(line, direct);
    link(line, matrix);
    link(matrix, sound);
    link(sound, deferred);
    link(deferred, after);
    link(after, beyond);

    const links = choiceLinks(graph).map(({ source, choice, via, direct: isDirect }) => ({ source, choice, via: via.sort(), direct: isDirect }));
    // The whole chain Line → Matrix → Sound → Choice is marked; direct links are not.
    const edgeOf = (from: { id: string }, to: { id: string }) =>
      [...graph.connections].find((connection) => connection.outputNodeId === from.id && connection.inputNodeId === to.id)!.id;
    expect([...choiceRouteConnections(graph)].sort()).toEqual(
      [edgeOf(line, matrix), edgeOf(matrix, sound), edgeOf(sound, deferred)].sort(),
    );
    expect(links).toContainEqual({ source: line.id, choice: direct.id, via: [], direct: true });
    expect(links).toContainEqual({ source: line.id, choice: deferred.id, via: [matrix.id, sound.id].sort(), direct: false });
    // The walk stops at the choice and at the next line: that line shows its own choices.
    expect(links).toContainEqual({ source: after.id, choice: beyond.id, via: [], direct: true });
    expect(links).toHaveLength(3);
  });

  it("follows each linked copy of a line on its own", () => {
    const { graph, add, link } = build();
    const line = add("line", 0);
    const copy = graph.addAlias(line.id, at(0, 400));
    const matrix = add("matrix", 200);
    const choice = add("choice", 400);
    link(line, matrix, { output: copy.id });
    link(matrix, choice);
    expect(choiceLinks(graph)).toMatchObject([{ source: copy.id, choice: choice.id, via: [matrix.id], direct: false }]);
  });
});
