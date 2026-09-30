import type { PackFile } from "../graph/schema";

const sources = import.meta.glob("../../packs/pumpkin-quest/**/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const PREFIX = "../../packs/pumpkin-quest/";

/** The example pack shipped with the editor; used until the user chooses a pack folder. */
export const bundledPack = {
  label: "Pumpkin Quest (built-in example)",
  files: Object.entries(sources).map(([path, text]): PackFile => ({ path: path.slice(PREFIX.length), text })),
};
