import { BitmapFont, BitmapText } from "pixi.js";

export const FONT_REGULAR = "ng-ui";
export const FONT_BOLD = "ng-ui-bold";
const FONT_STACK = "'Segoe UI', 'Inter', system-ui, sans-serif";
/** Glyphs are rasterized large once and scaled down, so text stays readable when zooming in. */
const GLYPH_SIZE = 36;

const CHARS: (string | string[])[] = [[" ", "~"], ["А", "я"], "ЁёЇїІіЄєҐґ«»–—…·°±×÷№€"];

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
