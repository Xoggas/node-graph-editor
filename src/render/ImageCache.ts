import { Texture } from "pixi.js";

/** Longest side of cached previews; source art (often several thousand px) is downscaled once. */
const MAX_PREVIEW_SIZE = 512;

type Entry<W> =
  | { state: "loading"; waiters: Set<W> }
  | { state: "ready"; texture: Texture }
  | { state: "error"; message: string };

/**
 * Loads resource images once, downscaled to preview size, and tells waiting consumers when they
 * are ready. Textures are shared between all nodes that show the same file.
 */
export class ImageCache<W> {
  private readonly entries = new Map<string, Entry<W>>();

  constructor(
    private readonly read: (path: string) => Promise<Blob>,
    private readonly onReady: (waiters: Set<W>) => void,
  ) {}

  /** The texture when loaded, "loading" (the waiter is notified later) or "error". */
  get(path: string, waiter: W): Texture | "loading" | "error" {
    const entry = this.entries.get(path);
    if (!entry) {
      this.entries.set(path, { state: "loading", waiters: new Set([waiter]) });
      void this.load(path);
      return "loading";
    }
    if (entry.state === "loading") {
      entry.waiters.add(waiter);
      return "loading";
    }
    return entry.state === "ready" ? entry.texture : "error";
  }

  errorOf(path: string): string | null {
    const entry = this.entries.get(path);
    return entry?.state === "error" ? entry.message : null;
  }

  /** Drops every texture, e.g. when another pack is loaded. */
  clear(): void {
    for (const entry of this.entries.values()) {
      if (entry.state === "ready") {
        entry.texture.destroy(true);
      }
    }
    this.entries.clear();
  }

  private async load(path: string): Promise<void> {
    let result: Entry<W>;
    try {
      const source = await createImageBitmap(await this.read(path));
      const scale = Math.min(1, MAX_PREVIEW_SIZE / Math.max(source.width, source.height));
      let bitmap = source;
      if (scale < 1) {
        bitmap = await createImageBitmap(source, {
          resizeWidth: Math.max(1, Math.round(source.width * scale)),
          resizeHeight: Math.max(1, Math.round(source.height * scale)),
          resizeQuality: "high",
        });
        source.close();
      }
      result = { state: "ready", texture: Texture.from(bitmap) };
    } catch (error) {
      result = { state: "error", message: error instanceof Error ? error.message : String(error) };
    }
    const previous = this.entries.get(path);
    if (previous?.state !== "loading") {
      // Cleared while loading.
      if (result.state === "ready") result.texture.destroy(true);
      return;
    }
    this.entries.set(path, result);
    this.onReady(previous.waiters);
  }
}
