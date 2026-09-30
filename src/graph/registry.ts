import type { GraphModel } from "./graph";
import type { NodeModel } from "./node";
import { type PortDefinition, RegistryError } from "./types";

/** Anything is assignable to this type, mirroring System.Object in the Unity version. */
export const OBJECT_TYPE = "system.object";

export class DataTypeRegistry {
  private readonly parents = new Map<string, readonly string[]>();
  private readonly ancestorCache = new Map<string, ReadonlySet<string>>();

  constructor() {
    this.register(OBJECT_TYPE);
    this.register("system.bool");
    this.register("system.int");
    this.register("system.float");
    this.register("system.string");
  }

  get typeIds(): IterableIterator<string> {
    return this.parents.keys();
  }

  /** Registers a data type. `parents` are base types / interfaces the type can be assigned to. */
  register(typeId: string, parents: readonly string[] = []): void {
    if (!typeId.trim()) {
      throw new RegistryError("A data type id is required.");
    }
    const existing = this.parents.get(typeId);
    if (existing && !sameList(existing, parents)) {
      throw new RegistryError(`Data type id '${typeId}' is already registered with different parents.`);
    }
    for (const parent of parents) {
      if (!this.parents.has(parent)) {
        throw new RegistryError(`Parent type '${parent}' of '${typeId}' is not registered.`);
      }
    }
    this.parents.set(typeId, [...parents]);
    this.ancestorCache.clear();
  }

  has(typeId: string): boolean {
    return this.parents.has(typeId);
  }

  resolve(typeId: string): void {
    if (!this.has(typeId)) {
      throw new RegistryError(`Unknown graph data type '${typeId}'.`);
    }
  }

  /** True when a value of `sourceType` can flow into a port of `targetType`. */
  isAssignable(targetType: string, sourceType: string): boolean {
    if (targetType === OBJECT_TYPE || targetType === sourceType) {
      return true;
    }
    return this.ancestors(sourceType).has(targetType);
  }

  private ancestors(typeId: string): ReadonlySet<string> {
    const cached = this.ancestorCache.get(typeId);
    if (cached) {
      return cached;
    }
    const result = new Set<string>();
    const stack = [...(this.parents.get(typeId) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (!result.has(current)) {
        result.add(current);
        stack.push(...(this.parents.get(current) ?? []));
      }
    }
    this.ancestorCache.set(typeId, result);
    return result;
  }
}

export type NodeWidget<S> =
  | { kind: "label"; text: string }
  | {
      kind: "number";
      label: string;
      get: (state: S) => number;
      set: (state: S, value: number) => S;
    }
  | {
      kind: "button";
      label: string;
      action: (node: NodeModel<S>, graph: GraphModel) => void;
    };

export interface NodeDefinition<S = unknown> {
  typeId: string;
  displayName?: string;
  menuPath?: string;
  /** Static ports, always present on every instance. */
  ports?: readonly PortDefinition[];
  /** Dynamic ports a freshly created node starts with. */
  initialDynamicPorts?: readonly PortDefinition[];
  defaultState: () => S;
  /** Converts JSON state to the in-memory state. Throw to reject the document. */
  restoreState?: (raw: Record<string, unknown>) => S;
  /** Converts the in-memory state to JSON. Defaults to the state object itself. */
  captureState?: (state: S) => Record<string, unknown>;
  widgets?: readonly NodeWidget<S>[];
}

export interface NodeDescriptor {
  typeId: string;
  displayName: string;
  menuPath: string;
}

export class NodeTypeRegistry {
  private readonly definitions = new Map<string, NodeDefinition<any>>();

  constructor(readonly dataTypes: DataTypeRegistry) {}

  register<S>(definition: NodeDefinition<S>): void {
    const { typeId } = definition;
    if (!typeId.trim()) {
      throw new RegistryError("A node type id is required.");
    }
    const existing = this.definitions.get(typeId);
    if (existing && existing !== definition) {
      throw new RegistryError(`Node type id '${typeId}' is already registered.`);
    }
    for (const port of [...(definition.ports ?? []), ...(definition.initialDynamicPorts ?? [])]) {
      this.dataTypes.resolve(port.typeId);
    }
    this.definitions.set(typeId, definition);
  }

  get(typeId: string): NodeDefinition<any> | undefined {
    return this.definitions.get(typeId);
  }

  descriptors(): NodeDescriptor[] {
    return [...this.definitions.values()]
      .map((definition) => ({
        typeId: definition.typeId,
        displayName: definition.displayName?.trim() || definition.typeId,
        menuPath: definition.menuPath ?? "",
      }))
      .sort((a, b) => a.menuPath.localeCompare(b.menuPath) || a.displayName.localeCompare(b.displayName));
  }
}

export class NodeGraphRegistry {
  readonly dataTypes = new DataTypeRegistry();
  readonly nodes = new NodeTypeRegistry(this.dataTypes);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
