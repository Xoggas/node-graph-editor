import { type BitmapText, Container, Graphics } from "pixi.js";
import type { NodeModel } from "../graph/node";
import type { EnumField, FieldSchema } from "../graph/schema";
import type { Port, Vec2 } from "../graph/types";
import type { Rect } from "./geometry";
import { fitText, makeText, measureText } from "./text";
import { theme } from "./theme";

const HEADER_HEIGHT = 32;
const PORT_ROW_HEIGHT = 24;
const PORTS_PADDING = 4;
const BODY_PADDING = 8;
const FIELD_HEIGHT = 24;
const MULTILINE_LINES = 3;
const LINE_HEIGHT = 16;
const FIELD_GAP = 6;
const MIN_WIDTH = 220;
const MAX_WIDTH = 360;
const CORNER_RADIUS = 6;
const PORT_RADIUS = 5;
const PORT_LABEL_OFFSET = 13;
const LABEL_SIZE = 12;
const VALUE_SIZE = 12;
const LABEL_GAP = 10;
const MIN_VALUE_WIDTH = 96;

export interface PortLayout {
  port: Port;
  /** Position relative to the node origin. */
  x: number;
  y: number;
}

export type FieldKind = "number" | "text" | "multiline" | "bool" | "dropdown" | "segmented" | "readonly";

export interface FieldLayout {
  index: number;
  field: FieldSchema;
  kind: FieldKind;
  rect: Rect;
  /** Interactive area: the value box, checkbox row or segment strip. */
  hitRect: Rect;
  /** Segment rectangles for `segmented` enums, in option order. */
  segments?: Rect[];
}

export type NodeHit =
  | { kind: "port"; port: Port }
  | { kind: "field"; field: FieldLayout; segment: number | null }
  | { kind: "header" }
  | { kind: "body" };

export type PortHighlight = "normal" | "compatible" | "incompatible";

export interface NodeViewContext {
  isPortConnected(portId: string): boolean;
  /** Only consulted while a connection is being dragged. */
  portHighlight(port: Port): PortHighlight;
  portColor(typeId: string): number;
}

export class NodeView {
  readonly container = new Container();
  width = MIN_WIDTH;
  height = 0;
  ports: PortLayout[] = [];
  fields: FieldLayout[] = [];

  selected = false;
  hovered = false;
  hoveredPortId: string | null = null;
  hoveredField: number | null = null;
  hoveredSegment: number | null = null;
  /** Set when the node must be redrawn once it becomes visible again. */
  stale = false;

  private readonly background = new Graphics();
  private readonly detail = new Container();
  private readonly portsById = new Map<string, PortLayout>();
  private readonly valueTexts = new Map<number, BitmapText[]>();

  constructor(
    readonly node: NodeModel,
    private readonly context: NodeViewContext,
  ) {
    this.container.addChild(this.background, this.detail);
    this.rebuild();
    this.syncPosition();
  }

  get rect(): Rect {
    return { x: this.node.position.x, y: this.node.position.y, width: this.width, height: this.height };
  }

  get headerHeight(): number {
    return HEADER_HEIGHT;
  }

  syncPosition(): void {
    this.container.position.set(this.node.position.x, this.node.position.y);
  }

  setDetailVisible(visible: boolean): void {
    this.detail.visible = visible;
  }

  portWorldPosition(portId: string): Vec2 | null {
    const layout = this.portsById.get(portId);
    return layout ? { x: this.node.position.x + layout.x, y: this.node.position.y + layout.y } : null;
  }

  /** Recreates texts and layout. Needed when ports, the name or the schema change. */
  rebuild(): void {
    for (const child of this.detail.removeChildren()) {
      child.destroy();
    }
    this.valueTexts.clear();
    this.portsById.clear();

    const node = this.node;
    const fields = node.schema?.fields ?? [];
    const inputs = node.inputs;
    const outputs = node.outputs;

    // Width: title, port labels and field labels decide; values are shortened to fit.
    const maxLabel = (ports: Port[]) => ports.reduce((max, port) => Math.max(max, measureText(port.displayName, 12)), 0);
    const fieldLabelWidth = fields.reduce(
      (max, field) => (fieldKind(field) === "bool" ? max : Math.max(max, measureText(field.label, LABEL_SIZE))),
      0,
    );
    let width = Math.max(MIN_WIDTH, measureText(node.displayName, 13, true) + 40);
    width = Math.max(width, maxLabel(inputs) + maxLabel(outputs) + PORT_LABEL_OFFSET * 2 + 24);
    width = Math.max(width, BODY_PADDING * 2 + fieldLabelWidth + LABEL_GAP + MIN_VALUE_WIDTH);
    for (const field of fields) {
      if (field.type === "enum" && field.display === "segmented") {
        const segmentsWidth = field.options.reduce((sum, option) => sum + measureText(option.label, VALUE_SIZE) + 16, 0);
        width = Math.max(width, BODY_PADDING * 2 + measureText(field.label, LABEL_SIZE) + LABEL_GAP + segmentsWidth);
      }
    }
    width = Math.ceil(Math.min(MAX_WIDTH, width));
    this.width = width;

    // Header
    const titleText = fitText(node.displayName, width - 24, 13, true);
    const title = this.detail.addChild(makeText(titleText, 13, theme.textPrimary, true));
    title.position.set(12, Math.round((HEADER_HEIGHT - title.height) / 2));

    // Ports
    const rows = Math.max(inputs.length, outputs.length, 1);
    const portsTop = HEADER_HEIGHT + PORTS_PADDING;
    const rowCenter = (index: number) => portsTop + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    const labelWidth = width / 2 - PORT_LABEL_OFFSET - 6;
    this.ports = [];
    inputs.forEach((port, index) => {
      const layout = { port, x: 0, y: rowCenter(index) };
      const label = this.detail.addChild(makeText(fitText(port.displayName, labelWidth, 12), 12, theme.textPort));
      label.position.set(PORT_LABEL_OFFSET, Math.round(layout.y - label.height / 2));
      this.ports.push(layout);
    });
    outputs.forEach((port, index) => {
      const layout = { port, x: width, y: rowCenter(index) };
      const label = this.detail.addChild(makeText(fitText(port.displayName, labelWidth, 12), 12, theme.textPort));
      label.position.set(Math.round(width - PORT_LABEL_OFFSET - label.width), Math.round(layout.y - label.height / 2));
      this.ports.push(layout);
    });
    this.ports.forEach((layout) => this.portsById.set(layout.port.id, layout));
    let bottom = portsTop + rows * PORT_ROW_HEIGHT + PORTS_PADDING;

    // Fields
    this.fields = [];
    if (node.isPlaceholder) {
      const note = this.detail.addChild(makeText("Schema not found. The node data is kept as-is.", 11, theme.textMuted));
      note.position.set(BODY_PADDING, bottom + BODY_PADDING);
      bottom += BODY_PADDING * 2 + FIELD_HEIGHT;
    } else if (fields.length > 0) {
      let y = bottom + BODY_PADDING;
      fields.forEach((field, index) => {
        const layout = this.layoutField(index, field, y, fieldLabelWidth);
        this.fields.push(layout);
        y += layout.rect.height + FIELD_GAP;
      });
      bottom = y - FIELD_GAP + BODY_PADDING;
    }

    this.height = bottom;
    this.refreshValues();
    this.redraw();
  }

  /** Updates value texts after a data change without changing the layout. */
  refreshValues(): void {
    for (const layout of this.fields) {
      for (const text of this.valueTexts.get(layout.index) ?? []) {
        text.destroy();
      }
      this.valueTexts.delete(layout.index);
      const texts = this.createValueTexts(layout);
      this.valueTexts.set(layout.index, texts);
      texts.forEach((text) => this.detail.addChild(text));
    }
  }

  redraw(): void {
    const g = this.background;
    const { width, height } = this;
    const portsBottom = this.fields.length > 0 ? this.fields[0].rect.y - BODY_PADDING : height;
    const accent = this.node.schema?.color ?? null;
    g.clear();

    section(g, 0, 0, width, height, CORNER_RADIUS, CORNER_RADIUS).fill(theme.nodeBackground);
    section(g, 0, 0, width, HEADER_HEIGHT, CORNER_RADIUS, 0).fill(
      this.node.isPlaceholder ? theme.placeholderHeader : accent !== null ? mix(theme.nodeHeader, accent, 0.45) : theme.nodeHeader,
    );
    if (accent !== null) {
      g.rect(0, HEADER_HEIGHT - 2, width, 2).fill(accent);
    }
    section(g, 0, HEADER_HEIGHT, width, portsBottom - HEADER_HEIGHT, 0, portsBottom === height ? CORNER_RADIUS : 0).fill(
      theme.nodePorts,
    );

    for (const layout of this.fields) {
      this.drawField(g, layout);
    }

    const borderColor = this.selected ? theme.nodeBorderSelected : this.hovered ? theme.nodeBorderHover : theme.nodeBorder;
    g.roundRect(0, 0, width, height, CORNER_RADIUS).stroke({ width: this.selected ? 2 : 1, color: borderColor, alignment: 1 });

    for (const { port, x, y } of this.ports) {
      const color = this.context.portColor(port.typeId);
      const highlight = this.context.portHighlight(port);
      const alpha = highlight === "incompatible" ? theme.portIncompatibleAlpha : 1;
      const radius = port.id === this.hoveredPortId || highlight === "compatible" ? PORT_RADIUS + 1.5 : PORT_RADIUS;
      if (this.context.isPortConnected(port.id)) {
        g.circle(x, y, radius).fill({ color, alpha });
      } else {
        g.circle(x, y, radius).fill({ color: theme.nodePorts, alpha }).stroke({ width: 2, color, alpha });
      }
    }
  }

  /** Hit test in node-local coordinates. */
  hitTest(localX: number, localY: number, portRadius: number): NodeHit | null {
    for (const layout of this.ports) {
      const dx = localX - layout.x;
      const dy = localY - layout.y;
      if (dx * dx + dy * dy <= portRadius * portRadius) {
        return { kind: "port", port: layout.port };
      }
    }
    if (localX < 0 || localY < 0 || localX > this.width || localY > this.height) {
      return null;
    }
    if (localY <= HEADER_HEIGHT) {
      return { kind: "header" };
    }
    for (const layout of this.fields) {
      if (layout.kind === "readonly" || !contains(layout.hitRect, localX, localY)) {
        continue;
      }
      const segment = layout.segments?.findIndex((rect) => contains(rect, localX, localY)) ?? -1;
      return { kind: "field", field: layout, segment: segment >= 0 ? segment : null };
    }
    return { kind: "body" };
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private layoutField(index: number, field: FieldSchema, y: number, labelWidth: number): FieldLayout {
    const kind = fieldKind(field);
    const x = BODY_PADDING;
    const fullWidth = this.width - BODY_PADDING * 2;
    const height = kind === "multiline" ? FIELD_HEIGHT + LINE_HEIGHT * (MULTILINE_LINES - 1) : FIELD_HEIGHT;
    const rect = { x, y, width: fullWidth, height };

    if (kind === "bool") {
      const label = this.detail.addChild(makeText(fitText(field.label, fullWidth - 28, LABEL_SIZE), LABEL_SIZE, theme.textSecondary));
      label.position.set(x + 24, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
      return { index, field, kind, rect, hitRect: { x, y, width: Math.min(fullWidth, 28 + label.width), height } };
    }

    const label = this.detail.addChild(makeText(fitText(field.label, fullWidth / 2, LABEL_SIZE), LABEL_SIZE, theme.textSecondary));
    label.position.set(x, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
    const boxX = x + Math.min(labelWidth, fullWidth / 2) + LABEL_GAP;
    const box = { x: boxX, y, width: x + fullWidth - boxX, height };
    const layout: FieldLayout = { index, field, kind, rect, hitRect: box };

    if (kind === "segmented") {
      const options = (field as EnumField).options;
      const weights = options.map((option) => measureText(option.label, VALUE_SIZE) + 16);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let segmentX = box.x;
      layout.segments = weights.map((weight) => {
        const segmentWidth = (box.width * weight) / total;
        const segment = { x: segmentX, y: box.y, width: segmentWidth, height: box.height };
        segmentX += segmentWidth;
        return segment;
      });
    }
    return layout;
  }

  private createValueTexts(layout: FieldLayout): BitmapText[] {
    const { field, kind, hitRect: box } = layout;
    const value = this.node.data[field.id];
    const centerY = (text: BitmapText, rowY = box.y, rowHeight = FIELD_HEIGHT) => Math.round(rowY + (rowHeight - text.height) / 2);
    const inner = box.width - 16;

    switch (kind) {
      case "number": {
        const text = makeText(fitText(formatNumber(value), inner, VALUE_SIZE), VALUE_SIZE, theme.textPrimary);
        text.position.set(Math.round(box.x + box.width - 8 - text.width), centerY(text));
        return [text];
      }
      case "text": {
        const content = typeof value === "string" ? value : "";
        const placeholder = field.type === "string" ? field.placeholder ?? "" : "";
        const text = makeText(fitText(content || placeholder, inner, VALUE_SIZE), VALUE_SIZE, content ? theme.textPrimary : theme.textMuted);
        text.position.set(box.x + 8, centerY(text));
        return [text];
      }
      case "multiline": {
        const lines = wrapLines(typeof value === "string" ? value : "", inner, MULTILINE_LINES);
        return lines.map((line, index) => {
          const text = makeText(line, VALUE_SIZE, theme.textPrimary);
          text.position.set(box.x + 8, Math.round(box.y + 4 + index * LINE_HEIGHT));
          return text;
        });
      }
      case "bool":
        return value === true ? [positioned(makeText("✓", 13, theme.textPrimary, true), box.x + 4, box.y + 3)] : [];
      case "dropdown": {
        const option = (field as EnumField).options.find((candidate) => candidate.value === value);
        const text = makeText(fitText(option?.label ?? String(value ?? ""), inner - 12, VALUE_SIZE), VALUE_SIZE, theme.textPrimary);
        text.position.set(box.x + 8, centerY(text));
        const arrow = makeText("▾", VALUE_SIZE, theme.textMuted);
        arrow.position.set(Math.round(box.x + box.width - 8 - arrow.width), centerY(arrow));
        return [text, arrow];
      }
      case "segmented":
        return (field as EnumField).options.map((option, index) => {
          const segment = layout.segments![index];
          const text = makeText(option.label, VALUE_SIZE, option.value === value ? theme.textPrimary : theme.textSecondary);
          text.position.set(Math.round(segment.x + (segment.width - text.width) / 2), centerY(text));
          return text;
        });
      case "readonly": {
        const text = makeText(fitText(readonlySummary(field, value), inner, 11), 11, theme.textMuted);
        text.position.set(box.x + 8, centerY(text));
        return [text];
      }
    }
  }

  private drawField(g: Graphics, layout: FieldLayout): void {
    const { hitRect: box, kind, index } = layout;
    const hovered = this.hoveredField === index;
    const border = hovered ? theme.nodeBorderHover : theme.widgetBorder;
    switch (kind) {
      case "bool": {
        const checked = this.node.data[layout.field.id] === true;
        g.roundRect(box.x + 1, box.y + 5, 14, 14, 3)
          .fill(checked ? theme.checkboxChecked : theme.widgetBackground)
          .stroke({ width: 1, color: border, alignment: 1 });
        return;
      }
      case "segmented": {
        const value = this.node.data[layout.field.id];
        const options = (layout.field as EnumField).options;
        g.roundRect(box.x, box.y, box.width, box.height, 4).fill(theme.widgetBackground);
        layout.segments!.forEach((segment, segmentIndex) => {
          const active = options[segmentIndex].value === value;
          const hoveredSegment = hovered && this.hoveredSegment === segmentIndex;
          if (active || hoveredSegment) {
            g.roundRect(segment.x + 1, segment.y + 1, segment.width - 2, segment.height - 2, 3).fill(
              active ? theme.segmentActive : theme.buttonHover,
            );
          }
        });
        g.roundRect(box.x, box.y, box.width, box.height, 4).stroke({ width: 1, color: border, alignment: 1 });
        return;
      }
      case "readonly":
        g.roundRect(box.x, box.y, box.width, box.height, 4).stroke({ width: 1, color: theme.widgetBorderMuted, alignment: 1 });
        return;
      default:
        g.roundRect(box.x, box.y, box.width, box.height, 4)
          .fill(theme.widgetBackground)
          .stroke({ width: 1, color: border, alignment: 1 });
    }
  }
}

export function fieldKind(field: FieldSchema): FieldKind {
  switch (field.type) {
    case "int":
    case "float":
      return "number";
    case "string":
      return field.multiline ? "multiline" : "text";
    case "bool":
      return "bool";
    case "enum":
      return field.display === "segmented" ? "segmented" : "dropdown";
    default:
      return "readonly";
  }
}

export function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Number(value.toFixed(4))) : "—";
}

function readonlySummary(field: FieldSchema, value: unknown): string {
  if (field.type === "list") {
    const count = Array.isArray(value) ? value.length : 0;
    return `${count} item${count === 1 ? "" : "s"}`;
  }
  if (field.type === "unsupported") {
    return `${field.declaredType}: not supported yet`;
  }
  return "—";
}

/** Splits text into at most `maxLines` lines that fit `width`, marking truncation with an ellipsis. */
function wrapLines(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (measureText(candidate, VALUE_SIZE) <= width || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fitText(`${kept[maxLines - 1]}…`, width, VALUE_SIZE);
    return kept;
  }
  return lines.map((line) => fitText(line, width, VALUE_SIZE));
}

function positioned(text: BitmapText, x: number, y: number): BitmapText {
  text.position.set(x, y);
  return text;
}

/** Rectangle path with separate top and bottom corner radii. */
function section(g: Graphics, x: number, y: number, w: number, h: number, top: number, bottom: number): Graphics {
  g.moveTo(x + top, y);
  g.lineTo(x + w - top, y);
  if (top > 0) g.arcTo(x + w, y, x + w, y + top, top);
  g.lineTo(x + w, y + h - bottom);
  if (bottom > 0) g.arcTo(x + w, y + h, x + w - bottom, y + h, bottom);
  g.lineTo(x + bottom, y + h);
  if (bottom > 0) g.arcTo(x, y + h, x, y + h - bottom, bottom);
  g.lineTo(x, y + top);
  if (top > 0) g.arcTo(x, y, x + top, y, top);
  return g.closePath();
}

function mix(a: number, b: number, t: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}
