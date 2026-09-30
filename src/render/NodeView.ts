import { BitmapText, Container, Graphics } from "pixi.js";
import type { NodeModel } from "../graph/node";
import type { NodeWidget } from "../graph/registry";
import type { Port, Vec2 } from "../graph/types";
import type { Rect } from "./geometry";
import { makeText } from "./text";
import { theme, typeColor } from "./theme";

const HEADER_HEIGHT = 32;
const PORT_ROW_HEIGHT = 24;
const PORTS_PADDING = 4;
const BODY_PADDING = 8;
const WIDGET_HEIGHT = 24;
const WIDGET_GAP = 6;
const MIN_WIDTH = 220;
const CORNER_RADIUS = 6;
const PORT_RADIUS = 5;
const PORT_LABEL_OFFSET = 13;

const PLACEHOLDER_WIDGETS: NodeWidget<unknown>[] = [
  { kind: "label", text: "Unknown node type. Its data is kept as-is." },
];

export interface PortLayout {
  port: Port;
  /** Position relative to the node origin. */
  x: number;
  y: number;
}

export interface WidgetLayout {
  index: number;
  widget: NodeWidget<any>;
  rect: Rect;
  /** Clickable area (value box for number fields). */
  hitRect: Rect;
}

export type NodeHit = { kind: "port"; port: Port } | { kind: "widget"; widget: WidgetLayout } | { kind: "body" };

export type PortHighlight = "normal" | "compatible" | "incompatible";

export interface NodeViewContext {
  isPortConnected(portId: string): boolean;
  /** Only consulted while a connection is being dragged. */
  portHighlight(port: Port): PortHighlight;
}

export class NodeView {
  readonly container = new Container();
  width = MIN_WIDTH;
  height = 0;
  ports: PortLayout[] = [];
  widgets: WidgetLayout[] = [];

  selected = false;
  hovered = false;
  hoveredPortId: string | null = null;
  hoveredWidget: number | null = null;
  pressedWidget: number | null = null;
  /** Set when the node must be redrawn once it becomes visible again. */
  stale = false;

  private readonly background = new Graphics();
  private readonly detail = new Container();
  private readonly portsById = new Map<string, PortLayout>();
  private readonly valueTexts = new Map<number, BitmapText>();

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

  /** Recreates texts and layout. Needed when ports change. */
  rebuild(): void {
    for (const child of this.detail.removeChildren()) {
      child.destroy();
    }
    this.valueTexts.clear();
    this.portsById.clear();

    const node = this.node;
    const title = makeText(node.displayName, 13, theme.textPrimary, true);
    this.detail.addChild(title);

    const inputs = node.inputs;
    const outputs = node.outputs;
    const inputLabels = inputs.map((port) => this.detail.addChild(makeText(port.displayName, 12, theme.textPort)));
    const outputLabels = outputs.map((port) => this.detail.addChild(makeText(port.displayName, 12, theme.textPort)));
    const widgets = (node.definition ? node.definition.widgets ?? [] : PLACEHOLDER_WIDGETS) as NodeWidget<any>[];
    const widgetTexts = widgets.map((widget) => this.createWidgetTexts(widget));

    const maxWidth = (texts: BitmapText[]) => texts.reduce((max, text) => Math.max(max, text.width), 0);
    let width = Math.max(MIN_WIDTH, title.width + 32);
    width = Math.max(width, maxWidth(inputLabels) + maxWidth(outputLabels) + PORT_LABEL_OFFSET * 2 + 24);
    for (const texts of widgetTexts) {
      width = Math.max(width, texts.reduce((sum, text) => sum + text.width, 0) + BODY_PADDING * 2 + 48);
    }
    width = Math.ceil(width);

    // Header
    title.position.set(Math.round((width - title.width) / 2), Math.round((HEADER_HEIGHT - title.height) / 2));

    // Ports
    const rows = Math.max(inputs.length, outputs.length, 1);
    const portsTop = HEADER_HEIGHT + PORTS_PADDING;
    const rowCenter = (index: number) => portsTop + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    this.ports = [];
    inputs.forEach((port, index) => {
      const layout = { port, x: 0, y: rowCenter(index) };
      inputLabels[index].position.set(PORT_LABEL_OFFSET, Math.round(layout.y - inputLabels[index].height / 2));
      this.ports.push(layout);
    });
    outputs.forEach((port, index) => {
      const layout = { port, x: width, y: rowCenter(index) };
      const label = outputLabels[index];
      label.position.set(Math.round(width - PORT_LABEL_OFFSET - label.width), Math.round(layout.y - label.height / 2));
      this.ports.push(layout);
    });
    this.ports.forEach((layout) => this.portsById.set(layout.port.id, layout));
    let bottom = portsTop + rows * PORT_ROW_HEIGHT + PORTS_PADDING;

    // Widgets
    this.widgets = [];
    if (widgets.length > 0) {
      let y = bottom + BODY_PADDING;
      widgets.forEach((widget, index) => {
        const rect = { x: BODY_PADDING, y, width: width - BODY_PADDING * 2, height: WIDGET_HEIGHT };
        this.widgets.push(this.layoutWidget(index, widget, rect, widgetTexts[index]));
        y += WIDGET_HEIGHT + WIDGET_GAP;
      });
      bottom = y - WIDGET_GAP + BODY_PADDING;
    }

    this.width = width;
    this.height = bottom;
    this.refreshState();
    this.redraw();
  }

  /** Updates texts that depend on node state (e.g. number values). */
  refreshState(): void {
    for (const layout of this.widgets) {
      const text = this.valueTexts.get(layout.index);
      if (text && layout.widget.kind === "number") {
        text.text = formatNumber(layout.widget.get(this.node.state));
        text.position.set(
          Math.round(layout.hitRect.x + layout.hitRect.width - 8 - text.width),
          Math.round(layout.hitRect.y + (layout.hitRect.height - text.height) / 2),
        );
      }
    }
  }

  redraw(): void {
    const g = this.background;
    const { width, height } = this;
    const portsBottom = this.widgets.length > 0 ? this.widgets[0].rect.y - BODY_PADDING : height;
    g.clear();

    section(g, 0, 0, width, height, CORNER_RADIUS, CORNER_RADIUS).fill(theme.nodeBackground);
    section(g, 0, 0, width, HEADER_HEIGHT, CORNER_RADIUS, 0).fill(
      this.node.isPlaceholder ? theme.placeholderHeader : theme.nodeHeader,
    );
    section(g, 0, HEADER_HEIGHT, width, portsBottom - HEADER_HEIGHT, 0, portsBottom === height ? CORNER_RADIUS : 0).fill(
      theme.nodePorts,
    );
    g.moveTo(0, HEADER_HEIGHT).lineTo(width, HEADER_HEIGHT).stroke({ width: 1, color: 0x696d76 });

    for (const layout of this.widgets) {
      this.drawWidget(g, layout);
    }

    const borderColor = this.selected ? theme.nodeBorderSelected : this.hovered ? theme.nodeBorderHover : theme.nodeBorder;
    g.roundRect(0, 0, width, height, CORNER_RADIUS).stroke({ width: this.selected ? 2 : 1, color: borderColor, alignment: 1 });

    for (const { port, x, y } of this.ports) {
      const color = typeColor(port.typeId);
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
    for (const layout of this.widgets) {
      if (layout.widget.kind !== "label" && contains(layout.hitRect, localX, localY)) {
        return { kind: "widget", widget: layout };
      }
    }
    return { kind: "body" };
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private createWidgetTexts(widget: NodeWidget<any>): BitmapText[] {
    switch (widget.kind) {
      case "label":
        return [makeText(widget.text, 11, theme.textMuted)];
      case "number":
        return [makeText(widget.label, 12, theme.textSecondary), makeText("0.0000", 12, theme.textPrimary)];
      case "button":
        return [makeText(widget.label, 12, theme.textPrimary)];
    }
  }

  private layoutWidget(index: number, widget: NodeWidget<any>, rect: Rect, texts: BitmapText[]): WidgetLayout {
    texts.forEach((text) => this.detail.addChild(text));
    const centerY = (text: BitmapText) => Math.round(rect.y + (rect.height - text.height) / 2);
    switch (widget.kind) {
      case "label": {
        texts[0].position.set(rect.x, centerY(texts[0]));
        return { index, widget, rect, hitRect: rect };
      }
      case "number": {
        const [label, value] = texts;
        label.position.set(rect.x, centerY(label));
        const boxX = rect.x + label.width + 10;
        this.valueTexts.set(index, value);
        return { index, widget, rect, hitRect: { x: boxX, y: rect.y, width: rect.x + rect.width - boxX, height: rect.height } };
      }
      case "button": {
        texts[0].position.set(Math.round(rect.x + (rect.width - texts[0].width) / 2), centerY(texts[0]));
        return { index, widget, rect, hitRect: rect };
      }
    }
  }

  private drawWidget(g: Graphics, layout: WidgetLayout): void {
    const { hitRect: r, widget, index } = layout;
    const hovered = this.hoveredWidget === index;
    if (widget.kind === "number") {
      g.roundRect(r.x, r.y, r.width, r.height, 4)
        .fill(theme.widgetBackground)
        .stroke({ width: 1, color: hovered ? theme.nodeBorderHover : theme.widgetBorder, alignment: 1 });
    } else if (widget.kind === "button") {
      const fill = this.pressedWidget === index ? theme.buttonPressed : hovered ? theme.buttonHover : theme.buttonBackground;
      g.roundRect(r.x, r.y, r.width, r.height, 4)
        .fill(fill)
        .stroke({ width: 1, color: hovered ? theme.nodeBorderHover : theme.widgetBorder, alignment: 1 });
    }
  }
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

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && y >= rect.y && x <= rect.x + rect.width && y <= rect.y + rect.height;
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(4))) : "NaN";
}
