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

  /**
   * Palette entries: categories in the pack's `menus` order (others alphabetically after them),
   * nodes inside a category in the order the pack defines them.
   */
  descriptors(): NodeDescriptor[] {
    const menus = this.pack?.menus ?? [];
    const rank = (menu: string) => {
      const index = menus.indexOf(menu);
      return index < 0 ? menus.length : index;
    };
    return [...(this.pack?.nodes.values() ?? [])]
      .map((schema, order) => ({ schemaId: schema.id, title: schema.title, menu: schema.menu, color: schema.color, order }))
      .sort((a, b) => rank(a.menu) - rank(b.menu) || a.menu.localeCompare(b.menu) || a.order - b.order)
      .map(({ order: _order, ...descriptor }) => descriptor);
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
