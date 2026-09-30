import type { NodeSchema, PortTypeSchema, SchemaPack } from "./schema";

export interface NodeDescriptor {
  schemaId: string;
  title: string;
  menu: string;
  color: number | null;
}

/** Everything the editor knows about node kinds; built from a schema pack. */
export class SchemaRegistry {
  private readonly ancestorCache = new Map<string, ReadonlySet<string>>();

  constructor(readonly pack: SchemaPack | null = null) {}

  get portTypes(): Map<string, PortTypeSchema> {
    return this.pack?.portTypes ?? new Map();
  }

  getSchema(schemaId: string): NodeSchema | undefined {
    return this.pack?.nodes.get(schemaId);
  }

  hasPortType(typeId: string): boolean {
    return this.portTypes.has(typeId);
  }

  /** True when a value of port type `source` can flow into a port of type `target`. */
  isAssignable(target: string, source: string): boolean {
    return target === source || this.ancestors(source).has(target);
  }

  descriptors(): NodeDescriptor[] {
    return [...(this.pack?.nodes.values() ?? [])]
      .map((schema) => ({ schemaId: schema.id, title: schema.title, menu: schema.menu, color: schema.color }))
      .sort((a, b) => a.menu.localeCompare(b.menu) || a.title.localeCompare(b.title));
  }

  private ancestors(typeId: string): ReadonlySet<string> {
    let cached = this.ancestorCache.get(typeId);
    if (!cached) {
      const result = new Set<string>();
      const stack = [...(this.portTypes.get(typeId)?.extends ?? [])];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (!result.has(current)) {
          result.add(current);
          stack.push(...(this.portTypes.get(current)?.extends ?? []));
        }
      }
      cached = result;
      this.ancestorCache.set(typeId, cached);
    }
    return cached;
  }
}
