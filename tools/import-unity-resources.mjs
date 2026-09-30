#!/usr/bin/env node
/**
 * Builds a resource library for the Pumpkin Quest schema pack from the Unity project:
 * characters (with emotions), backgrounds, music, sfx and diary entries, keeping their asset ids.
 * Images are not copied — the library points at them through its `root`.
 *
 *   node tools/import-unity-resources.mjs <UnityProject/Assets> [packs/pumpkin-quest/resources/library.json]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const assetsDir = resolve(process.argv[2] ?? "");
const outFile = resolve(process.argv[3] ?? "packs/pumpkin-quest/resources/library.json");
if (!process.argv[2] || !existsSync(join(assetsDir, "Resources"))) {
  console.error("Usage: node tools/import-unity-resources.mjs <UnityProject/Assets> [out/library.json]");
  process.exit(1);
}

const toPosix = (path) => path.split(sep).join("/");

// --- Asset GUID → file ---------------------------------------------------------------------------
const guidToPath = new Map();
const walk = (directory) => {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
    } else if (entry.endsWith(".meta")) {
      const match = /^guid: ([0-9a-f]{32})/m.exec(readFileSync(path, "utf8"));
      if (match) guidToPath.set(match[1], toPosix(relative(assetsDir, path.slice(0, -".meta".length))));
    }
  }
};
walk(assetsDir);

// --- Emotion enum ----------------------------------------------------------------------------------
const emotionSource = findFile(assetsDir, "CharacterEmotion.cs");
const emotions = emotionSource
  ? [...readFileSync(emotionSource, "utf8").replace(/\/\/.*$/gm, "").matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$/gm)].map((m) => m[1])
  : [];
if (emotions.length === 0) {
  console.warn("CharacterEmotion.cs not found; emotions will be numbered.");
}

// --- Unity YAML helpers ----------------------------------------------------------------------------
const assets = (folder) =>
  existsSync(join(assetsDir, "Resources", folder))
    ? readdirSync(join(assetsDir, "Resources", folder))
        .filter((name) => name.endsWith(".asset"))
        .map((name) => readFileSync(join(assetsDir, "Resources", folder, name), "utf8"))
    : [];
const scalar = (text, key) => new RegExp(`^\\s*${key}: (.*)$`, "m").exec(text)?.[1]?.trim() ?? null;
const reference = (text, key) => {
  const guid = new RegExp(`^\\s*${key}: \\{[^}]*guid: ([0-9a-f]{32})`, "m").exec(text)?.[1];
  return guid ? guidToPath.get(guid) ?? null : null;
};
const nested = (text, parent, key) =>
  new RegExp(`^[ \\t]*${parent}:[ \\t]*\\r?\\n(?:[ \\t]+.*\\r?\\n)*?[ \\t]+${key}: (.*)$`, "m").exec(text)?.[1]?.trim() || null;

const items = [];
const skipped = [];
const add = (item) => (item.id ? items.push(item) : skipped.push(item.name));

for (const text of assets("Characters")) {
  const variants = [...text.matchAll(/- Emotion: (\d+)\s*\n\s*Sprite: \{[^}]*guid: ([0-9a-f]{32})/g)].map(([, index, guid]) => {
    const id = emotions[Number(index)] ?? `Emotion_${index}`;
    // "Arleen_Awkwardness_1" → "Awkwardness 1"; the id stays the game's enum name.
    const label = id.replace(/^[A-Z][a-z]+_(?=[A-Za-z])/, "").replace(/_/g, " ");
    return { id, label, image: guidToPath.get(guid) ?? null };
  });
  add({
    id: scalar(text, "_id"),
    type: "character",
    name: scalar(text, "m_Name"),
    image: variants.find((variant) => variant.id === "Idle")?.image ?? variants[0]?.image ?? null,
    variants: { emotions: variants },
    properties: { nameKey: nested(text, "Name", "Key"), isMainCharacter: scalar(text, "IsMainCharacter") === "1" },
  });
}
for (const text of assets("Background")) {
  add({
    id: scalar(text, "_id"),
    type: "background",
    name: scalar(text, "m_Name"),
    image: reference(text, "Sprite"),
    properties: { bloomIntensity: Number(scalar(text, "BloomIntensity") ?? 0) },
  });
}
for (const [folder, type, field] of [
  ["Music", "music", "Music"],
  ["Sfx", "sfx", "Sfx"],
]) {
  for (const text of assets(folder)) {
    add({ id: scalar(text, "_id"), type, name: scalar(text, "m_Name"), file: reference(text, field) });
  }
}
for (const text of assets("Diary")) {
  add({ id: scalar(text, "_id"), type: "diaryEntry", name: scalar(text, "m_Name"), properties: { textKey: nested(text, "Text", "Key") } });
}

const library = {
  // Relative to this file; resource paths below are relative to the Unity Assets folder.
  root: toPosix(relative(dirname(outFile), assetsDir)),
  items: items.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name)),
};
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify(library, null, 2)}\n`);

const counts = items.reduce((result, item) => ({ ...result, [item.type]: (result[item.type] ?? 0) + 1 }), {});
console.log(`Wrote ${items.length} resources to ${outFile}:`, counts);
if (skipped.length > 0) console.warn(`Skipped assets without an id: ${skipped.join(", ")}`);

function findFile(directory, name) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry === name) {
      return path;
    }
  }
  return null;
}
