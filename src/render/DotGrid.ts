import { Texture, TilingSprite } from "pixi.js";
import type { Viewport } from "../graph/types";
import { theme } from "./theme";

/** World distance between dots at the finest level. */
const WORLD_SPACING = 32;
/** Every n-th dot is a major dot. */
const MAJOR_EVERY = 5;
/** Below this on-screen spacing the next coarser level is used. */
const MIN_SCREEN_SPACING = 14;

/**
 * Screen-space dot background. The tile texture is regenerated only when the on-screen
 * spacing changes (zoom); panning just shifts the tile offset.
 */
export class DotGrid {
  readonly sprite: TilingSprite;
  private texture: Texture | null = null;
  private tileSize = 0;

  constructor() {
    this.sprite = new TilingSprite({ texture: Texture.EMPTY, width: 1, height: 1 });
  }

  resize(width: number, height: number): void {
    this.sprite.width = width;
    this.sprite.height = height;
  }

  update(viewport: Viewport): void {
    let spacing = WORLD_SPACING * viewport.zoom;
    while (spacing < MIN_SCREEN_SPACING) {
      spacing *= MAJOR_EVERY;
    }
    const tile = spacing * MAJOR_EVERY;
    if (Math.abs(tile - this.tileSize) > 0.01) {
      this.rebuildTexture(spacing);
      this.tileSize = tile;
    }
    // Dots sit at cell centers inside the tile; shift so they land on world multiples of the spacing.
    this.sprite.tilePosition.set(viewport.x - spacing / 2, viewport.y - spacing / 2);
  }

  destroy(): void {
    this.texture?.destroy(true);
    this.sprite.destroy();
  }

  private rebuildTexture(spacing: number): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const logicalTile = spacing * MAJOR_EVERY;
    const pixels = Math.max(1, Math.ceil(logicalTile * dpr));
    const cell = pixels / MAJOR_EVERY;
    const canvas = document.createElement("canvas");
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext("2d")!;

    // Fade minor dots in as they spread out, so switching levels does not pop.
    const minorAlpha = Math.min(1, Math.max(0, (spacing - MIN_SCREEN_SPACING) / MIN_SCREEN_SPACING)) * theme.dotMinor.alpha;
    for (let row = 0; row < MAJOR_EVERY; row++) {
      for (let column = 0; column < MAJOR_EVERY; column++) {
        const major = row === 0 && column === 0;
        const dot = major ? theme.dotMajor : theme.dotMinor;
        const alpha = major ? dot.alpha : minorAlpha;
        if (alpha <= 0) {
          continue;
        }
        context.fillStyle = `rgba(${(dot.color >> 16) & 255}, ${(dot.color >> 8) & 255}, ${dot.color & 255}, ${alpha})`;
        context.beginPath();
        context.arc((column + 0.5) * cell, (row + 0.5) * cell, dot.radius * dpr, 0, Math.PI * 2);
        context.fill();
      }
    }

    const previous = this.texture;
    this.texture = Texture.from(canvas, true);
    this.texture.source.scaleMode = "linear";
    this.sprite.texture = this.texture;
    this.sprite.tileScale.set(logicalTile / pixels);
    previous?.destroy(true);
  }
}
