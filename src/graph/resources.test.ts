import { describe, expect, it } from "vitest";
import { defaultVariant, joinPath, normalizePath, parseLibraries, parseResourceTypes, resourcesOfType } from "./resources";
import { parseSchemaPack } from "./schema";

const types = parseResourceTypes(
  {
    character: { label: "Characters", variants: { emotions: { default: "Idle" } } },
    music: { media: "audio" },
  },
  [],
);

describe("paths", () => {
  it("normalizes Windows and POSIX paths", () => {
    expect(normalizePath("C:\\Games\\Pack\\resources\\..\\art\\.\\a.png")).toBe("C:/Games/Pack/art/a.png");
    expect(joinPath("C:/Games/Pack", "resources", "../../Unity/Assets", "Sprites/a.png")).toBe("C:/Games/Unity/Assets/Sprites/a.png");
    expect(joinPath("/home/me/pack", "resources", ".", "a.png")).toBe("/home/me/pack/resources/a.png");
  });
});

describe("parseLibraries", () => {
  const library = parseLibraries(
    [
      {
        path: "resources/characters.json",
        text: JSON.stringify({
          root: "../../art",
          items: [
            {
              id: "arleen",
              type: "character",
              name: "Arleen",
              image: "arleen/idle.png",
              variants: { emotions: [{ id: "Idle", image: "arleen/idle.png" }, { id: "Laughter", image: "arleen/laughter.png" }] },
            },
            { id: "mother", type: "character", name: "Mother", variants: { emotions: [{ id: "Smile" }] } },
          ],
        }),
      },
      { path: "resources/audio.json", text: JSON.stringify({ items: [{ id: "theme", type: "music", name: "Theme", file: "theme.ogg" }] }) },
    ],
    types,
    "C:/Games/Pack",
    [],
  );

  it("resolves files against the library root", () => {
    const arleen = library.items.get("arleen")!;
    expect(arleen.image).toBe("C:/Games/art/arleen/idle.png");
    expect(arleen.variants.get("emotions")!.map((variant) => variant.image)).toEqual([
      "C:/Games/art/arleen/idle.png",
      "C:/Games/art/arleen/laughter.png",
    ]);
    expect(library.items.get("theme")!.file).toBe("C:/Games/Pack/resources/theme.ogg");
    expect(library.roots).toEqual(["C:/Games/art", "C:/Games/Pack/resources"]);
  });

  it("lists resources by type and picks default variants", () => {
    expect(resourcesOfType(library, "character").map((item) => item.name)).toEqual(["Arleen", "Mother"]);
    expect(defaultVariant(library, library.items.get("arleen")!, "emotions")).toBe("Idle");
    // falls back to the first variant when the type default is missing
    expect(defaultVariant(library, library.items.get("mother")!, "emotions")).toBe("Smile");
  });

  it("reports invalid items without failing", () => {
    const warnings: string[] = [];
    const result = parseLibraries(
      [{ path: "resources/bad.json", text: JSON.stringify({ items: [{ id: "x", type: "unknown" }, { type: "music" }] }) }],
      types,
      null,
      warnings,
    );
    expect(result.items.size).toBe(0);
    expect(warnings).toHaveLength(2);
  });
});

describe("one resource per file", () => {
  it("reads single-resource files against the pack's resources.root", () => {
    const warnings: string[] = [];
    const pack = parseSchemaPack(
      [
        {
          path: "pack.json",
          text: JSON.stringify({ id: "p", portTypes: {}, resources: { root: "../Unity/Assets" }, resourceTypes: { music: { media: "audio" } } }),
        },
        { path: "resources/music/Theme.json", text: JSON.stringify({ id: "theme", type: "music", name: "Theme", file: "Music/theme.ogg" }) },
        { path: "resources/music/Rain.json", text: JSON.stringify({ id: "rain", type: "music", name: "Rain", file: "Music/rain.ogg" }) },
        { path: "resources/broken.json", text: JSON.stringify({ name: "No id" }) },
      ],
      "C:/Games/Pack",
    );
    warnings.push(...pack.warnings);
    expect(resourcesOfType(pack.resources, "music").map((item) => item.file)).toEqual([
      "C:/Games/Unity/Assets/Music/rain.ogg",
      "C:/Games/Unity/Assets/Music/theme.ogg",
    ]);
    expect(pack.resources.roots).toEqual(["C:/Games/Unity/Assets"]);
    expect(warnings).toHaveLength(1);
  });
});

describe("resource fields in schemas", () => {
  it("validates resource types and variant sources", () => {
    const pack = parseSchemaPack([
      { path: "pack.json", text: JSON.stringify({ id: "p", portTypes: {}, resourceTypes: { character: { variants: { emotions: {} } } } }) },
      {
        path: "nodes/n.json",
        text: JSON.stringify([
          {
            id: "ok",
            fields: [
              { id: "speaker", type: "resource", resourceType: "character", previewHeight: 200 },
              { id: "emotion", type: "resourceVariant", source: "speaker", collection: "emotions" },
            ],
          },
          { id: "bad", fields: [{ id: "bg", type: "resource", resourceType: "background" }, { id: "e", type: "resourceVariant", source: "bg", collection: "x" }] },
        ]),
      },
    ]);
    expect(pack.nodes.get("ok")!.fields[0]).toMatchObject({ type: "resource", previewHeight: 200 });
    expect(pack.warnings).toEqual([
      "bad → bg: unknown resource type 'background'.",
      "bad → e: resource type 'background' has no variants 'x'.",
    ]);
  });
});
