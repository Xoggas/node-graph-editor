import { type NodeDefinition, NodeGraphRegistry } from "./registry";
import { NodeSchemaMismatchError } from "./types";

export interface NumberState {
  value: number;
}

type EmptyState = Record<string, never>;
const emptyState = (): EmptyState => ({});

export const NumberNode: NodeDefinition<NumberState> = {
  typeId: "sample.number",
  displayName: "Number",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Output", typeId: "system.float", displayName: "Value" }],
  defaultState: () => ({ value: 0 }),
  // "Value" keeps documents compatible with the Unity (Newtonsoft) serializer.
  captureState: (state) => ({ Value: state.value }),
  restoreState: (raw) => {
    const value = raw.Value ?? raw.value ?? 0;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new NodeSchemaMismatchError("Number state must contain a finite 'Value'.");
    }
    return { value };
  },
  widgets: [
    {
      kind: "number",
      label: "Value",
      get: (state) => state.value,
      set: (state, value) => ({ ...state, value }),
    },
  ],
};

export const FloatSinkNode: NodeDefinition<EmptyState> = {
  typeId: "sample.sink",
  displayName: "Float Sink",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Input", typeId: "system.float", displayName: "Value" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "Accepts a float input." }],
};

export const AddNode: NodeDefinition<EmptyState> = {
  typeId: "sample.add",
  displayName: "Add",
  menuPath: "Samples",
  ports: [
    { key: "a", direction: "Input", typeId: "system.float", displayName: "A" },
    { key: "b", direction: "Input", typeId: "system.float", displayName: "B" },
    { key: "result", direction: "Output", typeId: "system.float", displayName: "Result" },
  ],
  defaultState: emptyState,
};

export const DerivedValueSourceNode: NodeDefinition<EmptyState> = {
  typeId: "sample.derived-source",
  displayName: "Derived Value",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Output", typeId: "sample.derived-value", displayName: "Derived Value" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "DerivedValue output." }],
};

export const BaseValueSourceNode: NodeDefinition<EmptyState> = {
  typeId: "sample.base-source",
  displayName: "Base Value Source",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Output", typeId: "sample.base-value", displayName: "Base Value" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "BaseValue output." }],
};

export const BaseValueSinkNode: NodeDefinition<EmptyState> = {
  typeId: "sample.base-sink",
  displayName: "Base Value Sink",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Input", typeId: "sample.base-value", displayName: "Base Value" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "Accepts BaseValue and its derived types." }],
};

export const InterfaceValueSinkNode: NodeDefinition<EmptyState> = {
  typeId: "sample.interface-sink",
  displayName: "Interface Value Sink",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Input", typeId: "sample.value-interface", displayName: "IValue" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "Accepts IValue implementations." }],
};

export const DerivedValueSinkNode: NodeDefinition<EmptyState> = {
  typeId: "sample.derived-sink",
  displayName: "Derived Value Sink",
  menuPath: "Samples",
  ports: [{ key: "value", direction: "Input", typeId: "sample.derived-value", displayName: "Derived Value" }],
  defaultState: emptyState,
  widgets: [{ kind: "label", text: "Requires DerivedValue." }],
};

export const DynamicOutputNode: NodeDefinition<EmptyState> = {
  typeId: "sample.dynamic",
  displayName: "Dynamic Outputs",
  menuPath: "Samples",
  initialDynamicPorts: [{ key: "output-1", direction: "Output", typeId: "system.float", displayName: "Output 1" }],
  defaultState: emptyState,
  widgets: [
    {
      kind: "button",
      label: "Add output",
      action: (node, graph) => {
        let index = node.ports.length + 1;
        while (node.getPort(`output-${index}`)) {
          index++;
        }
        graph.addDynamicPort(node.id, {
          key: `output-${index}`,
          direction: "Output",
          typeId: "system.float",
          displayName: `Output ${index}`,
        });
      },
    },
  ],
};

export function registerSamples(registry: NodeGraphRegistry): void {
  registry.dataTypes.register("sample.base-value");
  registry.dataTypes.register("sample.value-interface");
  registry.dataTypes.register("sample.derived-value", ["sample.base-value", "sample.value-interface"]);

  for (const definition of [
    NumberNode,
    FloatSinkNode,
    AddNode,
    DerivedValueSourceNode,
    BaseValueSourceNode,
    BaseValueSinkNode,
    InterfaceValueSinkNode,
    DerivedValueSinkNode,
    DynamicOutputNode,
  ] as NodeDefinition<any>[]) {
    registry.nodes.register(definition);
  }
}

export function createSampleRegistry(): NodeGraphRegistry {
  const registry = new NodeGraphRegistry();
  registerSamples(registry);
  return registry;
}
