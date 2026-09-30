import { Container, Graphics } from "pixi.js";
import type { StickyNote } from "../graph/types";
import type { Rect } from "./geometry";
import { fitText, makeText, measureText } from "./text";
import { noteColor, theme } from "./theme";

const RADIUS = 6;
/** Colored strip along the top edge. */
const BAND_HEIGHT = 7;
/** Size of the folded bottom-right corner, which is also the resize handle. */
const FOLD = 16;
const PADDING_X = 12;
const PADDING_TOP = BAND_HEIGHT + 8;
const PADDING_BOTTOM = 10;
export const NOTE_TEXT_SIZE = 14;
export const NOTE_LINE_HEIGHT = 19;
const PLACEHOLDER = "Double-click to write a note";

export type NoteHit = "resize" | "body";

/** A sticky note on the canvas: a colored sheet with wrapped text and a folded corner to resize it. */
export class NoteView {
  readonly container = new Container();
  private readonly graphics = new Graphics();
  private readonly texts = new Container();
  selected = false;
  hovered = false;
  /** Hidden while the text is edited in place, so the editor does not show it twice. */
  editing = false;

  constructor(readonly note: StickyNote) {
    this.container.addChild(this.graphics, this.texts);
    this.syncPosition();
    this.redraw();
  }

  get id(): string {
    return this.note.id;
  }

  get rect(): Rect {
    return { x: this.note.position.x, y: this.note.position.y, width: this.note.size.width, height: this.note.size.height };
  }

  /** Where the text goes, in note-local coordinates (also the in-place editor's area). */
  get textRect(): Rect {
    const { width, height } = this.note.size;
    return { x: PADDING_X - 4, y: PADDING_TOP - 3, width: width - PADDING_X * 2 + 8, height: height - PADDING_TOP - PADDING_BOTTOM + 6 };
  }

  syncPosition(): void {
    this.container.position.set(this.note.position.x, this.note.position.y);
  }

  hitTest(localX: number, localY: number): NoteHit | null {
    const { width, height } = this.note.size;
    if (localX < 0 || localY < 0 || localX > width || localY > height) {
      return null;
    }
    return localX >= width - FOLD - 2 && localY >= height - FOLD - 2 ? "resize" : "body";
  }

  redraw(): void {
    const { width: w, height: h } = this.note.size;
    const colors = noteColor(this.note.color);
    const g = this.graphics;
    g.clear();

    // Soft shadow: two offset layers.
    sheet(g, 1, 4, w, h).fill({ color: theme.noteShadow, alpha: 0.18 });
    sheet(g, 0, 2, w, h).fill({ color: theme.noteShadow, alpha: 0.22 });

    sheet(g, 0, 0, w, h).fill(colors.body);
    // The band follows the rounded top corners.
    g.moveTo(0, BAND_HEIGHT)
      .lineTo(0, RADIUS)
      .arcTo(0, 0, RADIUS, 0, RADIUS)
      .lineTo(w - RADIUS, 0)
      .arcTo(w, 0, w, RADIUS, RADIUS)
      .lineTo(w, BAND_HEIGHT)
      .closePath()
      .fill(colors.band);
    // Folded corner: the back of the sheet and a crease shadow.
    g.moveTo(w - FOLD, h).lineTo(w - FOLD, h - FOLD + 3).quadraticCurveTo(w - FOLD, h - FOLD, w - FOLD + 3, h - FOLD).lineTo(w, h - FOLD).closePath().fill(colors.band);
    g.moveTo(w - FOLD, h).lineTo(w, h - FOLD).stroke({ width: 1, color: theme.noteShadow, alpha: 0.18 });

    if (this.selected || this.hovered) {
      sheet(g, -3, -3, w + 6, h + 6, RADIUS + 3).stroke({
        width: this.selected ? 2 : 1.5,
        color: this.selected ? theme.nodeBorderSelected : theme.nodeBorderHover,
        alpha: this.selected ? 1 : 0.8,
      });
    }

    this.drawText(w, h);
  }

  private drawText(w: number, h: number): void {
    for (const child of this.texts.removeChildren()) child.destroy();
    if (this.editing) return;
    const width = w - PADDING_X * 2;
    const maxLines = Math.max(1, Math.floor((h - PADDING_TOP - PADDING_BOTTOM) / NOTE_LINE_HEIGHT));
    const empty = this.note.text.trim() === "";
    const lines = empty ? [fitText(PLACEHOLDER, width, NOTE_TEXT_SIZE)] : wrap(this.note.text, width, maxLines);
    lines.forEach((line, index) => {
      const text = this.texts.addChild(makeText(line, NOTE_TEXT_SIZE, theme.noteText));
      text.alpha = empty ? 0.5 : 1;
      text.position.set(PADDING_X, PADDING_TOP + index * NOTE_LINE_HEIGHT);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Sheet outline: rounded corners except the folded bottom-right one. */
function sheet(g: Graphics, x: number, y: number, w: number, h: number, radius = RADIUS): Graphics {
  return g
    .moveTo(x + radius, y)
    .lineTo(x + w - radius, y)
    .arcTo(x + w, y, x + w, y + radius, radius)
    .lineTo(x + w, y + h - FOLD)
    .lineTo(x + w - FOLD, y + h)
    .lineTo(x + radius, y + h)
    .arcTo(x, y + h, x, y + h - radius, radius)
    .lineTo(x, y + radius)
    .arcTo(x, y, x + radius, y, radius)
    .closePath();
}

/** Word-wraps paragraphs to `width`; long words are cut, the last kept line gets an ellipsis. */
function wrap(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, NOTE_TEXT_SIZE) <= width || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    if (lines.length > maxLines) break;
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1]}…`, width, NOTE_TEXT_SIZE);
    return kept;
  }
  return lines.map((line) => fitText(line, width, NOTE_TEXT_SIZE));
}
