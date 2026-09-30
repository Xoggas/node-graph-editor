import type { GraphModel } from "./graph";
import type { NodeSchema } from "./schema";

const SEQUENCE = /^(\d+)\.(\d+)$/;

/**
 * Next "chapter.index" name, continuing the graph's numbering like the Unity editor did: the highest
 * chapter in use (1 when none) and the next free index in it.
 */
export function nextSequenceName(graph: GraphModel): string {
  let chapter = 1;
  const names: [number, number][] = [];
  for (const node of graph.nodes) {
    const match = SEQUENCE.exec(node.name.trim());
    if (match) {
      names.push([Number(match[1]), Number(match[2])]);
      chapter = Math.max(chapter, Number(match[1]));
    }
  }
  const index = names.filter(([nameChapter]) => nameChapter === chapter).reduce((max, [, value]) => Math.max(max, value), 0) + 1;
  return `${chapter}.${index}`;
}

/** Name a new node of `schema` should get, or null when the schema has no automatic naming. */
export function autoName(graph: GraphModel, schema: NodeSchema): string | null {
  return schema.naming.auto === "chapter.index" ? nextSequenceName(graph) : null;
}
