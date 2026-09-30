#!/usr/bin/env node
/**
 * Builds the resource library of the Pumpkin Quest schema pack from the Unity project: characters
 * (with emotions), backgrounds, music, sfx and diary entries, keeping their asset ids. Every resource
 * becomes its own file, `resources/<type>/<name>.json`; the pack's `resources.root` in pack.json
 * points at the Unity Assets folder, which image and file paths are relative to. Images are not copied.
 * Resource files of the imported types that no longer exist in Unity are removed.
 *
 *   node tools/import-unity-resources.mjs <UnityProject/Assets> [packs/pumpkin-quest]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const assetsDir = resolve(process.argv[2] ?? "");
const packDir = resolve(process.argv[3] ?? "packs/pumpkin-quest");
if (!process.argv[2] || !existsSync(join(assetsDir, "Resources")) || !existsSync(join(packDir, "pack.json"))) {
  console.error("Usage: node tools/import-unity-resources.mjs <UnityProject/Assets> [pack folder]");
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

// One file per resource; names that clash (case-insensitively) get the start of the id.
const resourcesDir = join(packDir, "resources");
const safe = (name) => name.replace(/[\\/:*?"<>|]/g, "_").trim();
const files = new Map();
for (const item of items.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))) {
  let file = join(resourcesDir, item.type, `${safe(item.name)}.json`);
  if (files.has(file.toLowerCase())) file = join(resourcesDir, item.type, `${safe(item.name)}-${item.id.slice(0, 8)}.json`);
  files.set(file.toLowerCase(), { file, item });
}
const types = new Set(items.map((item) => item.type));
for (const type of types) {
  const folder = join(resourcesDir, type);
  if (!existsSync(folder)) continue;
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (name.endsWith(".json") && !files.has(path.toLowerCase())) rmSync(path);
  }
}
for (const { file, item } of files.values()) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(item, null, 2)}\n`);
}

// pack.json → resources.root: the Assets folder, relative to the pack.
const manifestPath = join(packDir, "pack.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const root = toPosix(relative(packDir, assetsDir));
if (manifest.resources?.root !== root) {
  manifest.resources = { ...manifest.resources, root };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`pack.json → resources.root = ${root}`);
}

const counts = items.reduce((result, item) => ({ ...result, [item.type]: (result[item.type] ?? 0) + 1 }), {});
console.log(`Wrote ${items.length} resource files to ${resourcesDir}:`, counts);
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
