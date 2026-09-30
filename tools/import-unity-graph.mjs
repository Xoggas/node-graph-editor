#!/usr/bin/env node
/**
 * Converts a baked Pumpkin Quest dialogue graph from Unity into an editor graph for the
 * pumpkin-quest pack, and writes the dialogue texts into the pack's localization files.
 *
 *   node tools/import-unity-graph.mjs <UnityProject/Assets> <out.json> [graph name]
 *
 * - Node ids are kept (references to choices stay valid); positions come from the graph asset as they
 *   are, and nodes that would cover each other here (ours are taller: portraits, texts) move down.
 * - A choice with a condition becomes If(condition) → Choice, as the pack models conditions with If.
 * - Duplicates become one node plus linked copies: nodes of the same type with the same data and text
 *   whose outputs lead to the same nodes (flow), or with the same inputs (conditions). Choices that
 *   conditions refer to stay separate, since each one is its own saved decision.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { parseLocalizationTable, parseNodePositions } from "./unity-yaml.mjs";

const assetsDir = resolve(process.argv[2] ?? "");
const outFile = process.argv[3] ? resolve(process.argv[3]) : null;
const graphName = process.argv[4] ?? "Main Graph";
const packDir = resolve("packs/pumpkin-quest");
if (!outFile || !existsSync(join(assetsDir, "Resources", "Graphs", `${graphName}_Baked.json`))) {
  console.error("Usage: node tools/import-unity-graph.mjs <UnityProject/Assets> <out.json> [graph name]");
  process.exit(1);
}

/** Where the If that guards a choice goes, relative to the choice, and its size. */
const IF_OFFSET = { x: -240, y: 0 };
const IF_SIZE = { width: 220, height: 88 };
/** Space kept between nodes that had to be moved apart. */
const GAP = 16;
const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

const warnings = [];
const read = (path) => readFileSync(path, "utf8").replace(/^﻿/, "");
const graphsDir = join(assetsDir, "Resources", "Graphs");
const baked = JSON.parse(read(join(graphsDir, `${graphName}_Baked.json`)));
const positions = parseNodePositions(read(join(graphsDir, `${graphName}.asset`)));
const library = JSON.parse(read(join(packDir, "resources", "library.json")));
const resources = new Map(library.items.map((item) => [item.id, item]));
const emotions = csharpEnum(findSource("DialogueSystem/Data/CharacterEmotion.cs"));

const values = (value) => (value && Array.isArray(value.$values) ? value.$values : Array.isArray(value) ? value : []);
const typeOf = (node) => node.$type.split(",")[0].split(".").pop().replace(/^Baked/, "").replace(/Node$/, "");
const portMap = (ports) =>
  new Map(Object.entries(ports ?? {}).filter(([key]) => key !== "$type").map(([key, list]) => [key, values(list)]));

const source = Object.entries(baked.Nodes)
  .filter(([key]) => key !== "$type")
  .map(([, node]) => ({ ...node, type: typeOf(node), inputs: portMap(node.InputPorts), outputs: portMap(node.OutputPorts) }));
const byId = new Map(source.map((node) => [node.Id, node]));

// --- Node conversion -------------------------------------------------------------------------------

const COMPARISON = { 1: "Equal", 2: "NotEqual", 4: "Greater", 8: "GreaterOrEqual", 16: "Less", 32: "LessOrEqual" };
const resource = (id) => {
  if (!id || id === EMPTY_GUID) return null;
  if (!resources.has(id)) warnings.push(`Resource ${id} is not in the library.`);
  return id;
};
/** An explicit localization key only when it differs from the node name (the default key). */
const lineKey = (node) => (node.Line?.Key && node.Line.Key !== node.Name ? node.Line.Key : "");

/** Unity type → schema, data, and the schema port key of each Unity port. */
const CONVERT = {
  Start: () => ({ schema: "dialogue.start", ports: { Output: "out" } }),
  End: (n) => ({ schema: "dialogue.end", data: { endingType: ["GoToMainMenu", "Restart"][n.EndingType] ?? "GoToMainMenu" }, ports: { Input: "in" } }),
  NoChoice: line,
  MultipleChoice: line,
  MultipleChoiceOption: (n) => ({ schema: "dialogue.choice", named: true, data: { text: lineKey(n) }, ports: { Input: "in", Output: "out" } }),
  If: () => ({ schema: "dialogue.if", ports: { Input: "in", Condition: "condition", True: "true", False: "false" } }),
  ChoiceMatrix: (n) => {
    const ids = values(n.ChoiceNodeIds);
    const choices = ids.map((choice) => ({ id: randomUUID(), choice }));
    const states = values(n.States);
    const matrix = {};
    for (let outcome = 0; outcome < n.OutcomesCount; outcome++) {
      matrix[String(outcome)] = Object.fromEntries(choices.map((record, column) => [record.id, states[outcome * n.ChoicesCount + column] === true]));
    }
    const ports = { Input: "in", Default: "default" };
    for (let outcome = 0; outcome < n.OutcomesCount; outcome++) ports[`Output ${outcome}`] = `outcome:${outcome}`;
    return { schema: "dialogue.choice-matrix", named: true, data: { choices, outcomes: n.OutcomesCount, states: matrix }, ports };
  },
  HideUI: () => flowAction("dialogue.hide-ui", {}),
  Background: (n) => flowAction("dialogue.set-background", { background: resource(n.BackgroundId) }),
  PlayMusic: (n) => flowAction("dialogue.play-music", { music: resource(n.MusicId) }),
  PlaySfx: (n) => flowAction("dialogue.play-sfx", { sfx: resource(n.SfxId) }),
  AddDiaryEntry: (n) => flowAction("dialogue.add-diary-entry", { entry: resource(n.DiaryEntryId) }),
  StrikethroughDiaryEntry: (n) => flowAction("dialogue.strikethrough-diary-entry", { entry: resource(n.DiaryEntryId) }),
  ChangeVariable: (n) => flowAction("dialogue.change-variable", { variable: n.VariableName ?? "", valueToAdd: n.ValueToAdd ?? 0 }),
  AddRelationshipPoints: (n) =>
    flowAction("dialogue.add-relationship-points", { character: resource(n.CharacterId), pointsToAdd: n.PointsToAdd ?? 0 }),
  ChoiceWasMade: (n) => ({ schema: "condition.choice-was-made", data: { choice: n.ChoiceNodeId }, ports: { Result: "result" } }),
  ChoicesWereMade: (n) => {
    const states = values(n.States);
    const choices = values(n.ChoiceNodeIds).map((choice, index) => ({ id: randomUUID(), choice, made: states[index] !== false }));
    return { schema: "condition.choices-were-made", named: true, data: { choices }, ports: { Result: "result" } };
  },
  VariableComparer: (n) => ({
    schema: "condition.variable",
    data: { variable: n.VariableName ?? "", comparison: COMPARISON[n.Comparison] ?? "Equal", targetValue: n.TargetValue ?? 0 },
    ports: { Output: "result", Result: "result" },
  }),
  RelationshipPointComparer: (n) => ({
    schema: "condition.relationship-points",
    data: { character: resource(n.CharacterId), comparison: COMPARISON[n.Comparison] ?? "Equal", targetValue: n.TargetValue ?? 0 },
    ports: { Output: "result", Result: "result" },
  }),
  And: () => ({ schema: "condition.and", ports: { Conditions: "conditions", Output: "result", Result: "result" } }),
  Or: () => ({ schema: "condition.or", ports: { Conditions: "conditions", Output: "result", Result: "result" } }),
  Not: () => ({ schema: "condition.not", ports: { Condition: "condition", Output: "result", Result: "result" } }),
};

function line(n) {
  const speaker = resource(n.SpeakerId);
  let emotion = emotions[n.Emotion] ?? "Idle";
  const variants = speaker ? (resources.get(speaker)?.variants?.emotions ?? []) : [];
  if (speaker && !variants.some((variant) => variant.id === emotion)) {
    warnings.push(`Line '${n.Name}': ${resources.get(speaker)?.name} has no emotion '${emotion}', using Idle.`);
    emotion = "Idle";
  }
  const data = { speaker, line: lineKey(n) };
  if (speaker) data.emotion = emotion;
  return { schema: "dialogue.line", named: true, data, ports: { Input: "in", Output: "next" } };
}

function flowAction(schema, data) {
  return { schema, data, ports: { Input: "in", Output: "out" } };
}

/** Flow nodes run in order; conditions are pure values. */
const PURE = new Set(["ChoiceWasMade", "ChoicesWereMade", "VariableComparer", "RelationshipPointComparer", "And", "Or", "Not"]);

const converted = new Map();
for (const node of source) {
  const convert = CONVERT[node.type];
  if (!convert) {
    warnings.push(`Unsupported Unity node type '${node.type}' (${node.Name}) was skipped.`);
    continue;
  }
  const result = convert(node);
  const unityPosition = positions.get(node.Id);
  if (!unityPosition) warnings.push(`No position for '${node.Name}' (${node.Id}).`);
  converted.set(node.Id, {
    id: node.Id,
    type: node.type,
    schema: result.schema,
    // Unity's default names ("ChoicesWereMadeNode") say nothing the header does not.
    name: result.named && node.Name !== `${node.type}Node` ? node.Name : "",
    data: result.data ?? {},
    ports: result.ports,
    position: unityPosition ? { x: unityPosition.x, y: unityPosition.y } : { x: 0, y: 0 },
    size: estimateSize(result.schema, result.data ?? {}),
    source: node,
  });
}

// Keep the Unity layout, moving a node down only when it would cover one placed above it.
{
  const placedRects = [];
  const order = [...converted.values()].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  for (const node of order) {
    const rect = { ...node.position, ...node.size };
    for (let moved = true; moved; ) {
      moved = false;
      for (const other of placedRects) {
        if (overlaps(rect, other)) {
          rect.y = other.y + other.height + GAP;
          moved = true;
        }
      }
    }
    node.position = { x: rect.x, y: rect.y };
    placedRects.push(rect);
  }
}

// --- Connections (Unity lists only node ids per port; the input side tells which port) ------------

/** { from, fromPort, to, toPort } between Unity node ids, with Unity port names. */
const links = [];
for (const node of source) {
  for (const [outputPort, targets] of node.outputs) {
    for (const target of targets) {
      const targetNode = byId.get(target);
      if (!targetNode) {
        warnings.push(`'${node.Name}' → missing node ${target}.`);
        continue;
      }
      const inputs = [...targetNode.inputs].filter(([, sources]) => sources.includes(node.Id)).map(([port]) => port);
      if (inputs.length === 0) {
        warnings.push(`'${node.Name}'.${outputPort} → '${targetNode.Name}': the target does not list it as an input.`);
        continue;
      }
      // A bool output feeds a condition input, a flow output the flow input.
      const isBool = PURE.has(node.type);
      const input = inputs.find((port) => /Condition/.test(port) === isBool) ?? inputs[0];
      links.push({ from: node.Id, fromPort: outputPort, to: target, toPort: input });
    }
  }
}

// --- Duplicates → one node + linked copies ---------------------------------------------------------

const referencedChoices = new Set();
for (const node of source) {
  if (node.ChoiceNodeId) referencedChoices.add(node.ChoiceNodeId);
  for (const id of values(node.ChoiceNodeIds)) referencedChoices.add(id);
}
const canonical = new Map([...converted.keys()].map((id) => [id, id]));
const find = (id) => {
  while (canonical.get(id) !== id) id = canonical.get(id);
  return id;
};
const conditionOf = (id) => links.filter((link) => link.to === id && link.toPort === "Condition").map((link) => find(link.from)).sort();

const signature = (node) => {
  if (node.type === "MultipleChoiceOption" && (referencedChoices.has(node.id) || conditionOf(node.id).length > 0)) return null;
  if (node.type === "Start") return null;
  const text = node.source.Line?.Key ? (texts.ru.get(node.source.Line.Key) ?? node.source.Line.Key) : "";
  const base = [node.type, JSON.stringify(stripIds(node.data)), text];
  if (PURE.has(node.type)) {
    const inputs = links.filter((link) => link.to === node.id).map((link) => `${link.toPort}<${find(link.from)}`).sort();
    return [...base, ...inputs].join("|");
  }
  const outputs = links.filter((link) => link.from === node.id).map((link) => `${link.fromPort}>${find(link.to)}.${link.toPort}`).sort();
  return [...base, ...outputs].join("|");
};

const texts = {
  ru: parseLocalizationTable(read(join(assetsDir, "Resources", "Localization", "Dialogues", "russian.asset"))),
  en: parseLocalizationTable(read(join(assetsDir, "Resources", "Localization", "Dialogues", "english.asset"))),
};

// Merging can make predecessors / consumers identical in turn, so repeat until nothing changes.
for (let changed = true; changed; ) {
  changed = false;
  const groups = new Map();
  for (const node of converted.values()) {
    if (find(node.id) !== node.id) continue;
    const key = signature(node);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(node.id);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => converted.get(a).position.x - converted.get(b).position.x);
    for (const id of group.slice(1)) canonical.set(id, group[0]);
    changed = true;
  }
}

// --- Assemble the editor graph -----------------------------------------------------------------------

const nodes = [];
const aliases = [];
/** Unity node id → { node, view } in the editor graph. */
const placed = new Map();
for (const node of converted.values()) {
  const root = find(node.id);
  if (root === node.id) {
    nodes.push({ id: node.id, schema: node.schema, schemaVersion: 1, name: node.name, position: node.position, data: node.data });
    placed.set(node.id, { node: node.id, view: node.id });
  } else {
    const alias = { id: randomUUID(), node: root, position: node.position };
    aliases.push(alias);
    placed.set(node.id, { node: root, view: alias.id });
  }
}

const connections = [];
const seen = new Set();
const connect = (from, fromPort, to, toPort) => {
  const key = `${from.node}.${fromPort}>${to.node}.${toPort}`;
  if (seen.has(key)) return;
  seen.add(key);
  const ref = (end, port) => (end.view === end.node ? { node: end.node, port } : { node: end.node, port, view: end.view });
  connections.push({ id: randomUUID(), from: ref(from, fromPort), to: ref(to, toPort) });
};

// Choices with a condition: If(condition) takes the choice's flow inputs and leads into the choice.
// It goes left of the choice, at the nearest spot that does not cover another node.
const occupied = [...converted.values()].map((node) => ({ ...node.position, ...node.size }));
const free = (rect) => occupied.every((other) => !overlaps({ x: rect.x - GAP, y: rect.y - GAP, width: rect.width + 2 * GAP, height: rect.height + 2 * GAP }, other));
const placeGuard = (choice) => {
  for (let ring = 0; ring < 16; ring++) {
    for (const dy of ring === 0 ? [0] : [-ring * 50, ring * 50]) {
      for (const dx of [0, -240]) {
        const rect = { x: choice.position.x + IF_OFFSET.x + dx, y: choice.position.y + IF_OFFSET.y + dy, ...IF_SIZE };
        if (free(rect)) return rect;
      }
    }
  }
  return { x: choice.position.x + IF_OFFSET.x, y: choice.position.y + IF_OFFSET.y, ...IF_SIZE };
};
const guards = new Map();
for (const node of converted.values()) {
  if (node.type !== "MultipleChoiceOption" || conditionOf(node.id).length === 0) continue;
  const guard = { id: randomUUID(), schema: "dialogue.if", schemaVersion: 1, name: "", data: {} };
  const spot = placeGuard(node);
  occupied.push(spot);
  guard.position = { x: spot.x, y: spot.y };
  nodes.push(guard);
  guards.set(node.id, guard.id);
  connect({ node: guard.id, view: guard.id }, "true", placed.get(node.id), "in");
}

for (const link of links) {
  const from = converted.get(link.from);
  const to = converted.get(link.to);
  if (!from || !to) continue;
  const fromPort = from.ports[link.fromPort];
  let target = placed.get(link.to);
  let toPort = to.ports[link.toPort];
  const guard = guards.get(link.to);
  if (guard) {
    target = { node: guard, view: guard };
    toPort = link.toPort === "Condition" ? "condition" : "in";
  }
  if (!fromPort || !toPort) {
    warnings.push(`Unknown port ${from.type}.${link.fromPort} → ${to.type}.${link.toPort}.`);
    continue;
  }
  connect(placed.get(link.from), fromPort, target, toPort);
}

const start = placed.get(baked.StartNodeId);
const startPosition = nodes.find((node) => node.id === start?.node)?.position ?? { x: 0, y: 0 };
const graph = {
  format: "node-graph",
  version: 2,
  graphId: randomUUID(),
  pack: { id: "pumpkin-quest", version: 1 },
  viewport: { x: 200 - startPosition.x * 0.5, y: 300 - startPosition.y * 0.5, zoom: 0.5 },
  nodes,
  aliases,
  connections,
  unresolvedConnections: [],
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(graph, null, 2)}\n`);

// Texts: the Dialogues tables become the pack's localization (keys unchanged).
const localizationDir = join(packDir, "localization");
mkdirSync(localizationDir, { recursive: true });
for (const [language, table] of Object.entries(texts)) {
  const target = join(localizationDir, `${language}.json`);
  const existing = existsSync(target) ? JSON.parse(read(target)) : {};
  writeFileSync(target, `${JSON.stringify({ ...existing, ...Object.fromEntries(table) }, null, 2)}\n`);
}

const merged = converted.size - nodes.length + guards.size;
console.log(`${source.length} Unity nodes → ${nodes.length} nodes (${guards.size} If added for choice conditions), ${aliases.length} linked copies (${merged} duplicates merged), ${connections.length} connections.`);
console.log(`Texts: ${texts.ru.size} ru, ${texts.en.size} en → ${localizationDir}`);
console.log(`Graph: ${outFile}`);
if (warnings.length) console.log(`\n${warnings.length} warning(s):\n${[...new Set(warnings)].join("\n")}`);

// --- Helpers ----------------------------------------------------------------------------------------

/** Rough size of a node in the editor (measured per schema), a little generous. */
function estimateSize(schema, data) {
  const list = (key) => (Array.isArray(data[key]) ? data[key].length : 0);
  switch (schema) {
    case "dialogue.line":
      return { width: 240, height: data.speaker ? 410 : 200 };
    case "dialogue.choice":
      return { width: 260, height: 140 };
    case "dialogue.set-background":
      return { width: 220, height: 256 };
    case "dialogue.add-relationship-points":
      return { width: 220, height: 346 };
    case "dialogue.choice-matrix":
      return { width: 320, height: 200 + 34 * list("choices") + 22 * (data.outcomes ?? 0) };
    case "condition.choices-were-made":
      return { width: 370, height: 110 + 56 * list("choices") };
    case "condition.variable":
    case "condition.relationship-points":
      return { width: 240, height: schema === "condition.variable" ? 170 : 360 };
    case "dialogue.change-variable":
      return { width: 220, height: 140 };
    case "dialogue.if":
      return IF_SIZE;
    case "dialogue.start":
    case "dialogue.hide-ui":
    case "condition.not":
    case "condition.and":
    case "condition.or":
      return { width: 220, height: 68 };
    default:
      return { width: 224, height: 108 };
  }
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Data without the generated record ids, so equal data compares equal. */
function stripIds(value) {
  if (Array.isArray(value)) return value.map(stripIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "id").map(([key, inner]) => [key, stripIds(inner)]));
  }
  return value;
}

function findSource(relative) {
  const path = join(assetsDir, "Scripts", relative);
  return existsSync(path) ? read(path) : "";
}

function csharpEnum(text) {
  const body = /enum\s+\w+\s*\{([^}]*)\}/.exec(text.replace(/\/\/.*$/gm, ""))?.[1] ?? "";
  return body.split(",").map((item) => item.trim()).filter(Boolean);
}
