import { describe, expect, it } from "vitest";
import { mouseControls, shortcuts } from "../app/shortcuts";
import { NOTE_COLORS } from "../graph/types";
import { translatedKeys } from "./index";
import { plural } from "./plural";
import { ru } from "./ru";

/** Every English text the code passes to `t` (and to helpers that forward to it), as written. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const literal = String.raw`"((?:[^"\\]|\\.)*)"`;
  const patterns = [new RegExp(String.raw`\bt\(\s*${literal}`, "g"), new RegExp(String.raw`\bcounted\(\s*${literal},\s*${literal}`, "g")];
  // The sources as text (tests and the dictionaries themselves aside).
  const sources = import.meta.glob(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../i18n/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;
  for (const source of Object.values(sources)) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) {
        for (const group of match.slice(1)) if (group !== undefined) keys.add(JSON.parse(`"${group}"`));
      }
    }
  }
  // Texts translated where they are shown, not where they are written.
  for (const shortcut of shortcuts) keys.add(shortcut.description).add(shortcut.group);
  for (const control of mouseControls) {
    keys.add(control.description);
    control.keys.forEach((key) => keys.add(key));
  }
  for (const color of NOTE_COLORS) keys.add(color[0].toUpperCase() + color.slice(1));
  ["All", "Missing text", "Unused", "Copy", "Link", "Arrows", "Shift+Arrows"].forEach((key) => keys.add(key));
  keys.add(
    "New nodes with new names. Their texts are copied under the new names (keys) and from then on are edited separately.",
  );
  keys.add(
    "Linked copies: the same nodes shown in another place — same data, name, texts and id, so editing one changes all of them " +
      "and a choice made through any copy is the same choice. Connections are not shared: each copy has its own.",
  );
  return keys;
}

describe("interface translations", () => {
  it("translate every interface text into Russian", () => {
    const missing = [...usedKeys()].filter((key) => !(key in ru)).sort();
    expect(missing).toEqual([]);
  });

  it("keep the placeholders of the English text", () => {
    const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const key of translatedKeys("ru")) {
      const entry = ru[key];
      if (typeof entry === "string") {
        // A template must use exactly the parameters the code passes.
        expect(params(entry), key).toEqual(params(key));
      } else {
        // A function must fill in every parameter.
        const text = entry(Object.fromEntries(params(key).map((name) => [name, 7])));
        expect(text, key).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it("chooses Russian plural forms", () => {
    const forms = [1, 2, 5, 11, 21, 22, 25, 111].map((count) => plural(count, "элемент", "элемента", "элементов"));
    expect(forms).toEqual(["элемент", "элемента", "элементов", "элементов", "элемент", "элемента", "элементов", "элементов"]);
  });
});
