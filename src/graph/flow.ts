import type { GraphModel } from "./graph";

// The dialogue flow: connections of port types that are `required` on both ends (e.g. "flow").
// Places are view ids: a node id, or the id of one of its linked copies.

/** Connections of types required on both ends (the dialogue flow) lead from one place to the next. */
export function traversed(graph: GraphModel, typeId: string): boolean {
  const type = graph.registry.portTypes.get(typeId);
  return !!type && type.required.input && type.required.output;
}

/** The flow connections leaving a place, with the place each one leads to. */
export function flowConnections(graph: GraphModel, viewId: string): { to: string; connection: string }[] {
  const node = graph.viewNode(viewId);
  const result: { to: string; connection: string }[] = [];
  for (const port of node?.outputs ?? []) {
    if (!traversed(graph, port.typeId)) continue;
    for (const connection of graph.getPortConnections(port.id)) {
      if (connection.outputPortId === port.id && connection.outputViewId === viewId) {
        result.push({ to: connection.inputViewId, connection: connection.id });
      }
    }
  }
  return result;
}

/** Places connected by the flow (see `traversed`), from each output to the input it leads to. */
export function flowSuccessors(graph: GraphModel, viewId: string): string[] {
  return flowConnections(graph, viewId).map((link) => link.to);
}
