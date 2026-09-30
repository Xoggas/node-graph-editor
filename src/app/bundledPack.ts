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
  /** Absolute folder in dev builds, so its resource library can find files; null in release builds. */
  dir: import.meta.env.DEV ? __BUNDLED_PACK_DIR__ : null,
  files: Object.entries(sources).map(([path, text]): PackFile => ({ path: path.slice(PREFIX.length), text })),
};
