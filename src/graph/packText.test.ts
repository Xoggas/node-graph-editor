import { afterEach, describe, expect, it } from "vitest";
import { setUiLanguage } from "../i18n";
import { createNode, relabelPorts } from "./node";
import { SchemaRegistry } from "./registry";
import { parseSchemaPack } from "./schema";

const pack = parseSchemaPack([
  {
    path: "pack.json",
    text: JSON.stringify({
      id: "t",
      name: { en: "Quest", ru: "Квест" },
      menus: [{ en: "Dialogue", ru: "Диалог" }],
      portTypes: { flow: { label: { en: "Flow", ru: "Поток" } } },
    }),
  },
  {
    path: "nodes/dialogue/line.json",
    text: JSON.stringify({
      id: "line",
      title: { en: "Line", ru: "Реплика" },
      menu: "Dialogue",
      description: { en: "Someone speaks.", ru: "Кто-то говорит." },
      ports: [{ id: "next", direction: "output", type: "flow", label: { en: "Next", ru: "Далее" } }],
      fields: [
        { id: "mood", type: "enum", label: { en: "Mood", ru: "Настроение" }, options: [{ value: "calm", label: { en: "Calm", ru: "Спокойно" } }] },
        { id: "note", type: "string", label: "Note" },
      ],
    }),
  },
]);

afterEach(() => setUiLanguage("en"));

describe("translated pack texts", () => {
  it("follow the interface language, falling back to English", () => {
    const schema = pack.nodes.get("line")!;
    const registry = new SchemaRegistry(pack);
    const node = createNode(registry, "line");
    expect(pack.warnings).toEqual([]);
    expect([pack.name, schema.title, schema.menu, schema.description, schema.fields[0].label]).toEqual(["Quest", "Line", "Dialogue", "Someone speaks.", "Mood"]);

    setUiLanguage("ru");
    relabelPorts(node, registry);
    expect([pack.name, schema.title, schema.menu, schema.description, schema.fields[0].label]).toEqual(["Квест", "Реплика", "Диалог", "Кто-то говорит.", "Настроение"]);
    expect(schema.fields[0].type === "enum" && schema.fields[0].options[0].label).toBe("Спокойно");
    expect(pack.portTypes.get("flow")!.label).toBe("Поток");
    expect(node.ports[0].displayName).toBe("Далее");
    // Untranslated texts stay as written.
    expect(schema.fields[1].label).toBe("Note");
    expect(registry.descriptors().map((descriptor) => descriptor.menu)).toEqual(["Диалог"]);
  });
});
