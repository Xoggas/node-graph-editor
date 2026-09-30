import type { GraphModel } from "./graph";
import { t } from "../i18n";
import { localizationKey } from "./localization";
import type { NodeModel } from "./node";
import { type FieldSchema, isRecord } from "./schema";
import type { Port } from "./types";
import { flowSuccessors, traversed } from "./flow";

export type ProblemSeverity = "error" | "warning";

export interface Problem {
  severity: ProblemSeverity;
  message: string;
  /** The node the problem is about, when there is one. */
  nodeId?: string;
  /** The place to show: the node itself or one of its linked copies (connection problems are per copy). */
  viewId?: string;
}

export interface ValidationSources {
  languages: readonly string[];
  text(language: string, key: string): string | undefined;
}

/**
 * "Compile" checks of a graph. What must be connected and filled in comes from the schema pack:
 * port types list `required` directions, fields are `required`, string fields may be `symbol`s
 * (e.g. variables) that are read somewhere and written elsewhere.
 */
export function validateGraph(graph: GraphModel, sources: ValidationSources): Problem[] {
  const problems: Problem[] = [];
  const pack = graph.registry.pack;
  const symbols = new Map<string, { writes: Set<string>; reads: { name: string; node: NodeModel; field: FieldSchema }[] }>();

  // --- Whole graph ---
  const entrySchema = pack?.exportEntry;
  const entries = entrySchema ? [...graph.nodes].filter((node) => node.schemaId === entrySchema) : [];
  if (entrySchema) {
    const title = pack?.nodes.get(entrySchema)?.title ?? entrySchema;
    if (entries.length === 0) problems.push({ severity: "error", message: t("There is no '{type}' node: the dialogue has nowhere to start.", { type: title }) });
    if (entries.length > 1) {
      for (const entry of entries.slice(1)) {
        problems.push({ severity: "error", message: t("There are {count} '{type}' nodes; only the first one is used.", { count: entries.length, type: title }), nodeId: entry.id, viewId: entry.id });
      }
    }
  }
  if (graph.unresolvedConnections.length > 0) {
    problems.push({ severity: "error", message: t("{count} connection(s) from the file could not be restored.", { count: graph.unresolvedConnections.length }) });
  }

  const reached = reachableViews(graph, entries.map((node) => node.id));

  // A flow loop the dialogue can go round without ever stopping for the player never ends.
  for (const loop of flowLoops(graph)) {
    const nodes = loop.map((viewId) => graph.viewNode(viewId)!);
    if (nodes.some((node) => node.schema?.blocking)) continue;
    const names = nodes.slice(0, 4).map((node, index) => nodeLabel(node, loop[index] !== node.id));
    const route = `${names.join(" → ")}${nodes.length > 4 ? " → …" : ""}`;
    problems.push({ severity: "error", message: t("Endless loop: {route} — nothing in it waits for the player.", { route }), nodeId: nodes[0].id, viewId: loop[0] });
  }

  for (const node of graph.nodes) {
    if (!node.schema) {
      problems.push({ severity: "error", message: t("{node}: unknown node type '{type}'.", { node: nodeLabel(node), type: node.schemaId }), nodeId: node.id, viewId: node.id });
      continue;
    }

    // --- Connections, per place (the node and each linked copy) ---
    for (const viewId of graph.viewIdsOf(node.id)) {
      const where = nodeLabel(node, viewId !== node.id);
      let flowInput = false;
      let flowInputConnected = false;
      for (const port of node.ports) {
        const type = graph.registry.portTypes.get(port.typeId);
        const optional = node.schema.ports.find((schemaPort) => schemaPort.id === port.key.split(":")[0])?.optional;
        const required = !optional && (port.direction === "Input" ? type?.required.input : type?.required.output);
        const connected = isConnected(graph, port, viewId);
        if (traversed(graph, port.typeId)) {
          if (port.direction === "Input") {
            flowInput = true;
            flowInputConnected ||= connected;
          }
        }
        if (required && !connected) {
          const message =
            port.direction === "Output"
              ? t("{node}: output '{port}' is not connected: the dialogue stops here.", { node: where, port: port.displayName })
              : t("{node}: input '{port}' is not connected.", { node: where, port: port.displayName });
          problems.push({ severity: "warning", message, nodeId: node.id, viewId });
        }
      }
      if (entries.length > 0 && flowInput && flowInputConnected && !reached.has(viewId)) {
        problems.push({ severity: "warning", message: t("{node}: cannot be reached from the start.", { node: where }), nodeId: node.id, viewId });
      }
    }

    // --- Data (shared by the copies: reported once) ---
    checkData(graph, node, problems, symbols);

    // --- Texts ---
    for (const field of node.schema.fields) {
      visitLocalized(node, field, node.data[field.id], [field.id], (key, label) => {
        if (!key) {
          problems.push({ severity: "error", message: t("{node} → {field}: no localization key (name the node).", { node: nodeLabel(node), field: label }), nodeId: node.id, viewId: node.id });
          return;
        }
        const missing = sources.languages.filter((language) => !sources.text(language, key)?.trim());
        if (missing.length > 0) {
          const languages = missing.map((language) => language.toUpperCase()).join(", ");
          problems.push({ severity: "warning", message: t("{node} → {field}: no {languages} text (key '{key}').", { node: nodeLabel(node), field: label, languages, key }), nodeId: node.id, viewId: node.id });
        }
      });
    }
  }

  for (const [kind, symbol] of symbols) {
    for (const read of symbol.reads) {
      if (!symbol.writes.has(read.name)) {
        problems.push({
          severity: "warning",
          message: t("{node} → {field}: {kind} '{name}' is never set by any node.", {
            node: nodeLabel(read.node),
            field: read.field.label,
            kind,
            name: read.name,
          }),
          nodeId: read.node.id,
          viewId: read.node.id,
        });
      }
    }
  }

  return problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

/** "'1.26' (Line)", "'1.26' (Line, copy)", or the type alone for unnamed nodes. */
function nodeLabel(node: NodeModel, copy = false): string {
  const title = node.schema?.title ?? node.schemaId;
  const suffix = copy ? t("{type}, copy", { type: title }) : title;
  return node.displayName !== title ? `'${node.displayName}' (${suffix})` : copy ? t("{type} (copy)", { type: title }) : title;
}

function isConnected(graph: GraphModel, port: Port, viewId: string): boolean {
  for (const connection of graph.getPortConnections(port.id)) {
    if ((connection.outputPortId === port.id ? connection.outputViewId : connection.inputViewId) === viewId) return true;
  }
  return false;
}


function reachableViews(graph: GraphModel, starts: string[]): Set<string> {
  const reached = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length > 0) {
    const viewId = queue.pop()!;
    const node = graph.viewNode(viewId);
    if (!node) continue;
    for (const port of node.outputs) {
      if (!traversed(graph, port.typeId)) continue;
      for (const connection of graph.getPortConnections(port.id)) {
        if (connection.outputPortId !== port.id || connection.outputViewId !== viewId || reached.has(connection.inputViewId)) continue;
        reached.add(connection.inputViewId);
        queue.push(connection.inputViewId);
      }
    }
  }
  return reached;
}


/** Strongly connected parts of the flow that loop (Tarjan), each as a list of places. */
function flowLoops(graph: GraphModel): string[][] {
  const views = [...graph.nodes].flatMap((node) => graph.viewIdsOf(node.id));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const loops: string[][] = [];
  let counter = 0;
  // Iterative, so long dialogue chains cannot overflow the call stack.
  for (const root of views) {
    if (index.has(root)) continue;
    const work: { view: string; next: string[]; position: number }[] = [];
    const open = (view: string) => {
      index.set(view, counter);
      low.set(view, counter++);
      stack.push(view);
      onStack.add(view);
      work.push({ view, next: flowSuccessors(graph, view), position: 0 });
    };
    open(root);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.position < frame.next.length) {
        const next = frame.next[frame.position++];
        if (!index.has(next)) open(next);
        else if (onStack.has(next)) low.set(frame.view, Math.min(low.get(frame.view)!, index.get(next)!));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].view;
        low.set(parent, Math.min(low.get(parent)!, low.get(frame.view)!));
      }
      if (low.get(frame.view) === index.get(frame.view)) {
        const component: string[] = [];
        let view: string;
        do {
          view = stack.pop()!;
          onStack.delete(view);
          component.push(view);
        } while (view !== frame.view);
        if (component.length > 1 || flowSuccessors(graph, frame.view).includes(frame.view)) loops.push(component.reverse());
      }
    }
  }
  return loops;
}

type Symbols = Map<string, { writes: Set<string>; reads: { name: string; node: NodeModel; field: FieldSchema }[] }>;

function checkData(graph: GraphModel, node: NodeModel, problems: Problem[], symbols: Symbols): void {
  const report = (severity: ProblemSeverity, label: string, message: string) =>
    problems.push({ severity, message: t("{node} → {field}: {message}", { node: nodeLabel(node), field: label, message }), nodeId: node.id, viewId: node.id });

  const visit = (field: FieldSchema, value: unknown, label: string): void => {
    const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
    if (field.required && empty) {
      report("warning", label, t("not set."));
    }
    if (field.symbol && typeof value === "string" && value.trim()) {
      const symbol = symbols.get(field.symbol.kind) ?? { writes: new Set<string>(), reads: [] };
      symbols.set(field.symbol.kind, symbol);
      if (field.symbol.use === "write") symbol.writes.add(value.trim());
      else symbol.reads.push({ name: value.trim(), node, field });
    }
    switch (field.type) {
      case "nodeRef":
        if (typeof value === "string" && value && !graph.getNode(value)) report("error", label, t("the referenced node was deleted."));
        break;
      case "itemRef":
        if (typeof value === "string" && value && !graph.findItem(value)) report("error", label, t("the referenced element was deleted."));
        break;
      case "resource":
        if (typeof value === "string" && value && !graph.registry.pack?.resources.items.has(value)) report("error", label, t("the resource is not in the library."));
        break;
      case "list":
        if (Array.isArray(value)) {
          if (field.minItems !== undefined && value.length < field.minItems && !(field.required && value.length === 0)) {
            report("warning", label, t("needs at least {count} item(s).", { count: field.minItems }));
          }
          value.forEach((item, index) => visit(field.item, item, `${label} ${index + 1}`));
        }
        break;
      case "record":
        if (isRecord(value)) {
          for (const child of field.fields) visit(child, value[child.id], `${label} → ${child.label}`);
        }
        break;
    }
  };
  for (const field of node.schema!.fields) {
    visit(field, node.data[field.id], field.label);
  }
}

function visitLocalized(
  node: NodeModel,
  field: FieldSchema,
  value: unknown,
  path: (string | number)[],
  onText: (key: string | null, label: string) => void,
  label = field.label,
): void {
  if (field.type === "localizedText") {
    onText(localizationKey(node, field, path, value), label);
  } else if (field.type === "list" && Array.isArray(value)) {
    value.forEach((item, index) => visitLocalized(node, field.item, item, [...path, index], onText, `${label} ${index + 1}`));
  } else if (field.type === "record" && isRecord(value)) {
    for (const child of field.fields) visitLocalized(node, child, value[child.id], [...path, child.id], onText, `${label} → ${child.label}`);
  }
}
