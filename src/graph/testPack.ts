import { SchemaRegistry } from "./registry";
import { type PackFile, parseSchemaPack } from "./schema";

/** A small pack exercising every core feature; used by unit tests. */
export const testPackFiles: PackFile[] = [
  {
    path: "pack.json",
    text: JSON.stringify({
      id: "test",
      version: 1,
      languages: ["ru"],
      portTypes: {
        flow: { color: "#b8bcc5", capacity: { input: "multiple", output: "single" } },
        bool: { color: "#e07a6f" },
        number: {},
        integer: { extends: ["number"] },
      },
    }),
  },
  {
    path: "nodes/flow.json",
    text: JSON.stringify([
      {
        id: "test.start",
        title: "Start",
        singleton: true,
        naming: { editable: false },
        ports: [{ id: "out", direction: "output", type: "flow" }],
      },
      {
        id: "test.line",
        title: "Line",
        naming: { unique: true },
        ports: [
          { id: "in", direction: "input", type: "flow" },
          { id: "condition", direction: "input", type: "bool", repeat: { list: "choices", label: "If {item.text}" } },
          { id: "choice", direction: "output", type: "flow", repeat: { list: "choices", label: "{item.text}" } },
          { id: "next", direction: "output", type: "flow" },
        ],
        fields: [
          { id: "text", type: "string", multiline: true },
          {
            id: "choices",
            type: "list",
            maxItems: 5,
            itemLabel: "Choice {n}: {item.text}",
            item: { type: "record", fields: [{ id: "text", type: "string" }, { id: "extra", type: "bool" }] },
          },
        ],
      },
      {
        id: "test.matrix",
        title: "Matrix",
        ports: [
          { id: "in", direction: "input", type: "flow" },
          { id: "outcome", direction: "output", type: "flow", repeat: { count: "outcomes", label: "Output {i}" } },
        ],
        fields: [{ id: "outcomes", type: "int", min: 0, max: 4, default: 2 }],
      },
    ]),
  },
  {
    path: "nodes/logic.json",
    text: JSON.stringify([
      {
        id: "test.compare",
        title: "Compare",
        naming: { editable: false },
        ports: [{ id: "result", direction: "output", type: "bool" }],
        fields: [
          { id: "variable", type: "string" },
          { id: "op", type: "enum", display: "segmented", options: [{ value: "Equal", label: "=" }, { value: "Greater", label: ">" }] },
          { id: "value", type: "int" },
        ],
      },
      {
        id: "test.and",
        title: "And",
        ports: [
          { id: "conditions", direction: "input", type: "bool", capacity: "multiple" },
          { id: "result", direction: "output", type: "bool" },
        ],
      },
      {
        id: "test.picker",
        title: "Picker",
        ports: [{ id: "result", direction: "output", type: "bool" }],
        fields: [{ id: "choice", type: "itemRef", schema: "test.line", list: "choices" }],
      },
      {
        id: "test.grid",
        title: "Grid",
        fields: [
          { id: "columns", type: "list", item: { type: "record", fields: [{ id: "name", type: "string" }] } },
          { id: "rows", type: "int", min: 0, max: 5, default: 2 },
          { id: "cells", type: "matrix", rows: "rows", columns: "columns" },
        ],
      },
      {
        id: "test.node-picker",
        title: "Node picker",
        fields: [{ id: "target", type: "nodeRef", schema: "test.line" }],
      },
      {
        id: "test.int-source",
        title: "Int",
        ports: [{ id: "out", direction: "output", type: "integer" }],
      },
      {
        id: "test.number-sink",
        title: "Number sink",
        ports: [{ id: "in", direction: "input", type: "number" }],
      },
    ]),
  },
];

export function createTestRegistry(): SchemaRegistry {
  return new SchemaRegistry(parseSchemaPack(testPackFiles));
}
