import { describe, expect, it } from "vitest";
import { GraphModel } from "./graph";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";
import { validateGraph } from "./validate";

const registry = new SchemaRegistry(
  parseSchemaPack([
    {
      path: "pack.json",
      text: JSON.stringify({
        id: "v",
        languages: ["ru", "en"],
        portTypes: {
          flow: { capacity: { input: "multiple", output: "single" }, required: ["input", "output"] },
          bool: { required: ["input"] },
        },
        export: { entry: "start" },
      }),
    },
    {
      path: "nodes/n.json",
      text: JSON.stringify([
        { id: "start", title: "Start", ports: [{ id: "out", direction: "output", type: "flow" }] },
        { id: "end", title: "End", ports: [{ id: "in", direction: "input", type: "flow" }] },
        {
          id: "choice",
          title: "Choice",
          ports: [
            { id: "in", direction: "input", type: "flow" },
            { id: "out", direction: "output", type: "flow" },
          ],
          fields: [{ id: "text", type: "localizedText", keyFrom: "name" }],
        },
        {
          id: "if",
          title: "If",
          ports: [
            { id: "in", direction: "input", type: "flow" },
            { id: "condition", direction: "input", type: "bool" },
            { id: "true", direction: "output", type: "flow" },
            { id: "false", direction: "output", type: "flow", optional: true },
          ],
        },
        {
          id: "wait",
          title: "Wait",
          blocking: true,
          ports: [
            { id: "in", direction: "input", type: "flow" },
            { id: "out", direction: "output", type: "flow" },
          ],
        },
        {
          id: "set",
          title: "Set Variable",
          ports: [
            { id: "in", direction: "input", type: "flow" },
            { id: "out", direction: "output", type: "flow" },
          ],
          fields: [{ id: "name", type: "string", required: true, symbol: { kind: "variable", use: "write" } }],
        },
        {
          id: "check",
          title: "Check Variable",
          ports: [{ id: "result", direction: "output", type: "bool" }],
          fields: [{ id: "name", type: "string", required: true, symbol: { kind: "variable", use: "read" } }],
        },
      ]),
    },
  ]),
);

const texts: Record<string, Record<string, string>> = { ru: { a: "Да", b: "Нет" }, en: { a: "Yes" } };
const run = (graph: GraphModel) =>
  validateGraph(graph, { languages: ["ru", "en"], text: (language, key) => texts[language]?.[key] }).map((problem) => problem.message);
const at = (x: number, y = 0) => ({ x, y });

describe("validateGraph", () => {
  it("passes a complete dialogue", () => {
    const graph = new GraphModel(registry);
    const start = graph.addNode("start", at(0));
    const choice = graph.addNode("choice", at(200));
    const end = graph.addNode("end", at(400));
    graph.renameNode(choice.id, "a");
    graph.connect(start.getPort("out")!.id, choice.getPort("in")!.id);
    graph.connect(choice.getPort("out")!.id, end.getPort("in")!.id);
    expect(run(graph)).toEqual([]);
  });

  it("reports dead ends, missing inputs and unreachable nodes per linked copy", () => {
    const graph = new GraphModel(registry);
    const start = graph.addNode("start", at(0));
    const choice = graph.addNode("choice", at(200));
    graph.renameNode(choice.id, "a");
    const end = graph.addNode("end", at(400));
    graph.connect(start.getPort("out")!.id, choice.getPort("in")!.id);
    graph.connect(choice.getPort("out")!.id, end.getPort("in")!.id);
    // A copy reached from the start through another choice, but leading nowhere.
    const other = graph.addNode("choice", at(200, 300));
    graph.renameNode(other.id, "b");
    const copy = graph.addAlias(choice.id, at(400, 300));
    graph.connect(other.getPort("out")!.id, choice.getPort("in")!.id, undefined, { input: copy.id });
    expect(run(graph)).toEqual([
      "'a' (Choice, copy): output 'Out' is not connected: the dialogue stops here.",
      // Only 'b' leads to the copy, and nothing leads to 'b'.
      "'a' (Choice, copy): cannot be reached from the start.",
      "'b' (Choice): input 'In' is not connected.",
      "'b' (Choice) → Text: no EN text (key 'b').",
    ]);

    // An island with a connected input that the start never leads to.
    const island = [graph.addNode("choice", at(0, 900)), graph.addNode("choice", at(200, 900))];
    island.forEach((node) => graph.renameNode(node.id, "a"));
    graph.connect(island[0].getPort("out")!.id, island[1].getPort("in")!.id);
    graph.connect(island[1].getPort("out")!.id, island[0].getPort("in")!.id);
    expect(run(graph).filter((message) => message.endsWith("(Choice): cannot be reached from the start."))).toHaveLength(2);
  });

  it("knows optional ports, required fields and symbols that are never set", () => {
    const graph = new GraphModel(registry);
    const start = graph.addNode("start", at(0));
    const branch = graph.addNode("if", at(200));
    const set = graph.addNode("set", at(400));
    const end = graph.addNode("end", at(600));
    const check = graph.addNode("check", at(0, 200));
    graph.connect(start.getPort("out")!.id, branch.getPort("in")!.id);
    graph.connect(check.getPort("result")!.id, branch.getPort("condition")!.id);
    graph.connect(branch.getPort("true")!.id, set.getPort("in")!.id);
    graph.connect(set.getPort("out")!.id, end.getPort("in")!.id);
    graph.setNodeData(set.id, { name: "" });
    graph.setNodeData(check.id, { name: "gold" });
    expect(run(graph)).toEqual(["Set Variable → Name: not set.", "Check Variable → Name: variable 'gold' is never set by any node."]);

    graph.setNodeData(set.id, { name: "gold" });
    expect(run(graph)).toEqual([]);
  });

  it("reports a flow loop that never waits for the player", () => {
    const graph = new GraphModel(registry);
    const start = graph.addNode("start", at(0));
    const branch = graph.addNode("if", at(200));
    const set = graph.addNode("set", at(400));
    const check = graph.addNode("check", at(0, 200));
    graph.setNodeData(set.id, { name: "gold" });
    graph.setNodeData(check.id, { name: "gold" });
    graph.connect(start.getPort("out")!.id, branch.getPort("in")!.id);
    graph.connect(check.getPort("result")!.id, branch.getPort("condition")!.id);
    graph.connect(branch.getPort("true")!.id, set.getPort("in")!.id);
    graph.connect(set.getPort("out")!.id, branch.getPort("in")!.id);
    expect(run(graph)).toEqual(["Endless loop: If → Set Variable — nothing in it waits for the player."]);

    // With a blocking node in the loop, going round is the player's choice.
    const wait = graph.addNode("wait", at(600));
    graph.disconnect([...graph.getPortConnections(set.getPort("out")!.id)][0].id);
    graph.connect(set.getPort("out")!.id, wait.getPort("in")!.id);
    graph.connect(wait.getPort("out")!.id, branch.getPort("in")!.id);
    expect(run(graph)).toEqual([]);
  });

  it("reports a missing start, texts without a key and deleted references as errors", () => {
    const graph = new GraphModel(registry);
    graph.addNode("choice", at(0));
    const problems = validateGraph(graph, { languages: ["ru"], text: () => undefined });
    expect(problems.filter((problem) => problem.severity === "error").map((problem) => problem.message)).toEqual([
      "There is no 'Start' node: the dialogue has nowhere to start.",
      "Choice → Text: no localization key (name the node).",
    ]);
  });
});
