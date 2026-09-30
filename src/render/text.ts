import { BitmapFont, BitmapText } from "pixi.js";

export const FONT_REGULAR = "ng-ui";
export const FONT_BOLD = "ng-ui-bold";
const FONT_STACK = "'Segoe UI', 'Inter', system-ui, sans-serif";
/** Glyphs are rasterized large once and scaled down, so text stays readable when zooming in. */
const GLYPH_SIZE = 36;

const CHARS: (string | string[])[] = [[" ", "~"], ["А", "я"], "ЁёЇїІіЄєҐґ«»–—…·°±×÷№€≠≥≤▾✓↵→←"];

let installed = false;

export function installFonts(): void {
  if (installed) {
    return;
  }
  installed = true;
  const resolution = Math.min(window.devicePixelRatio || 1, 2);
  BitmapFont.install({
    name: FONT_REGULAR,
    style: { fontFamily: FONT_STACK, fontSize: GLYPH_SIZE, fill: 0xffffff },
    chars: CHARS,
    resolution,
    padding: 4,
  });
  BitmapFont.install({
    name: FONT_BOLD,
    style: { fontFamily: FONT_STACK, fontSize: GLYPH_SIZE, fill: 0xffffff, fontWeight: "bold" },
    chars: CHARS,
    resolution,
    padding: 4,
  });
}

export function makeText(text: string, size: number, color: number, bold = false): BitmapText {
  const result = new BitmapText({
    text,
    style: { fontFamily: bold ? FONT_BOLD : FONT_REGULAR, fontSize: size },
  });
  result.tint = color;
  return result;
}

const measureCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null = null;

/** Width of `text` at `size` px, used to fit values into boxes before creating display objects. */
export function measureText(text: string, size: number, bold = false): number {
  const key = `${bold ? "b" : "r"}${size}:${text}`;
  let width = measureCache.get(key);
  if (width === undefined) {
    measureContext ??= document.createElement("canvas").getContext("2d")!;
    measureContext.font = `${bold ? "bold " : ""}${size}px ${FONT_STACK}`;
    width = measureContext.measureText(text).width;
    if (measureCache.size > 5000) {
      measureCache.clear();
    }
    measureCache.set(key, width);
  }
  return width;
}

/** Shortens `text` with an ellipsis so it fits into `maxWidth`. */
export function fitText(text: string, maxWidth: number, size: number, bold = false): string {
  if (measureText(text, size, bold) <= maxWidth) {
    return text;
  }
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureText(`${text.slice(0, middle)}…`, size, bold) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${text.slice(0, low)}…`;
}
