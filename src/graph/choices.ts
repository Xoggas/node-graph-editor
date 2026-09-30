import { flowConnections } from "./flow";
import type { GraphModel } from "./graph";

/** A choice shown by a blocking place, reached through non-blocking places only. */
export interface ChoiceLink {
  /** The blocking place (a node or a linked copy) that shows the choice. */
  source: string;
  /** The place of the choice. */
  choice: string;
  /** Non-blocking places on the way (conditions, matrices, actions). */
  via: string[];
  /** The connections of the routes through other places; a direct source → choice edge is not one. */
  connections: string[];
  /** The source is also connected to the choice directly. */
  direct: boolean;
}

/**
 * Which choices each blocking place (other than a choice) shows: following the flow from its outputs
 * through nodes that neither block nor are choices, every choice reached belongs to it. The walk stops
 * at choices (which may block themselves: the dialogue waits for the pick) and at other blocking nodes.
 * The link is transitive, e.g. Line → Choice Matrix → Choice.
 */
export function choiceLinks(graph: GraphModel): ChoiceLink[] {
  const links: ChoiceLink[] = [];
  for (const node of graph.nodes) {
    if (!node.schema?.blocking || node.schema.choice) continue;
    for (const source of graph.viewIdsOf(node.id)) {
      links.push(...linksFrom(graph, source));
    }
  }
  return links;
}

/** Ids of the connections on indirect routes from blocking places to the choices they show. */
export function choiceRouteConnections(graph: GraphModel): Set<string> {
  return new Set(choiceLinks(graph).flatMap((link) => link.connections));
}

function linksFrom(graph: GraphModel, source: string): ChoiceLink[] {
  // Forward: the non-blocking places reachable from the source, and the choices they lead to.
  const passage = new Set<string>();
  const incoming = new Map<string, { from: string; connection: string }[]>();
  const choices = new Set<string>();
  const queue = [source];
  while (queue.length > 0) {
    const from = queue.pop()!;
    for (const { to, connection } of flowConnections(graph, from)) {
      const schema = graph.viewNode(to)?.schema;
      if (!schema || (schema.blocking && !schema.choice)) continue;
      let edges = incoming.get(to);
      if (!edges) incoming.set(to, (edges = []));
      edges.push({ from, connection });
      if (schema.choice) {
        choices.add(to);
      } else if (!passage.has(to)) {
        passage.add(to);
        queue.push(to);
      }
    }
  }
  // Backward from each choice: the places and connections it is reached through.
  return [...choices].map((choice) => {
    const via = new Set<string>();
    const connections = new Set<string>();
    const back = [choice];
    while (back.length > 0) {
      const to = back.pop()!;
      for (const { from, connection } of incoming.get(to) ?? []) {
        if (to === choice && from === source) continue;
        connections.add(connection);
        if (from !== source && !via.has(from)) {
          via.add(from);
          back.push(from);
        }
      }
    }
    const direct = incoming.get(choice)!.some((edge) => edge.from === source);
    return { source, choice, via: [...via], connections: [...connections], direct };
  });
}
