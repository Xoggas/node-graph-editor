import { type BitmapText, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { type DataPath, getIn } from "../graph/dataOps";
import type { NodeModel } from "../graph/node";
import type { ResourceLibrary } from "../graph/resources";
import {
  dimensionKeys,
  type EnumField,
  type FieldSchema,
  formatLabel,
  isRecord,
  type ListField,
  type LocalizedTextField,
  type MatrixField,
  type ResourceField,
  type ResourceVariantField,
} from "../graph/schema";
import type { NodeAlias, Port, Vec2 } from "../graph/types";
import type { Rect } from "./geometry";
import { fitText, makeText, measureText } from "./text";
import { theme } from "./theme";

const HEADER_HEIGHT = 32;
/** Space between a node's name and its "(Type)" in the header. */
const TYPE_GAP = 6;
/** Space between the title and the link badge on the right of the header. */
const BADGE_GAP = 10;
/** Outer frame of a linked copy: distance from the node and line width. */
const ALIAS_FRAME_GAP = 4;
const ALIAS_FRAME_WIDTH = 2.5;
/** The "?" in the header of nodes whose schema has a description. */
const INFO_SIZE = 16;
const INFO_GAP = 8;
const PORT_ROW_HEIGHT = 24;
const PORTS_PADDING = 4;
const BODY_PADDING = 8;
const FIELD_HEIGHT = 24;
/** Text boxes show at least this many lines and grow to fit the whole text. */
const MULTILINE_LINES = 3;
/** Height of the label row above a multiline text box. */
const TALL_LABEL_HEIGHT = 20;
/** Screen size (px) of the node name shown when zoomed out. */
const OVERVIEW_TEXT_SIZE = 13;
const LINE_HEIGHT = 16;
const FIELD_GAP = 6;
const ITEM_GAP = 4;
const ITEM_INDENT = 22;
const BUTTON_SIZE = 18;
const BUTTON_GAP = 2;
const ITEM_BUTTONS_WIDTH = 3 * (BUTTON_SIZE + BUTTON_GAP) + 4;
const CELL_SIZE = 18;
const CELL_GAP = 3;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;
const MAX_MATRIX_WIDTH = 760;
const CORNER_RADIUS = 6;
const PORT_RADIUS = 5;
const PORT_LABEL_OFFSET = 13;
const LABEL_SIZE = 12;
const VALUE_SIZE = 12;
const SMALL_SIZE = 11;
const LABEL_GAP = 10;
const MIN_VALUE_WIDTH = 96;

/** `hoveredControl` value while the pointer is over the "?" icon. */
export const INFO_KEY = "info";

export interface PortLayout {
  port: Port;
  /** Position relative to the node origin. */
  x: number;
  y: number;
}

export type FieldKind =
  | "number"
  | "text"
  | "multiline"
  | "bool"
  | "dropdown"
  | "segmented"
  | "reference"
  | "resource"
  | "variant"
  | "localized"
  | "readonly";

export type ListAction =
  | { type: "add"; path: DataPath }
  | { type: "remove"; path: DataPath; index: number }
  | { type: "move"; path: DataPath; index: number; delta: number };

export type Control =
  | { type: "field"; key: string; path: DataPath; field: FieldSchema; kind: FieldKind; hitRect: Rect; segments?: Rect[] }
  | { type: "button"; key: string; rect: Rect; glyph: string; action: ListAction; enabled: boolean }
  | { type: "cell"; key: string; rect: Rect; fieldId: string; row: string; column: string };

export type NodeHit =
  | { kind: "port"; port: Port }
  | { kind: "control"; control: Control; segment: number | null }
  | { kind: "header" }
  /** The "?" icon: hovering it shows the schema description. */
  | { kind: "info" }
  | { kind: "body" };

export type PortHighlight = "normal" | "compatible" | "incompatible";

export interface NodeViewContext {
  /** Whether this view (the node or a linked copy) has a connection on the port. */
  isPortConnected(portId: string): boolean;
  /** Whether this view's port has a connection on the way from a line to a choice (see `choiceRouteConnections`). */
  isPortOnChoiceRoute(portId: string): boolean;
  /** Number of linked copies of the node. */
  aliasCount(): number;
  /** Only consulted while a connection is being dragged. */
  portHighlight(port: Port): PortHighlight;
  portColor(typeId: string): number;
  /** Display label of a referenced list element or node, or null when it does not exist. */
  referenceLabel(field: FieldSchema, id: string): string | null;
  resources(): ResourceLibrary | null;
  /** Key and text (in the display language) of a localized text field. */
  localizedText(field: LocalizedTextField, path: DataPath, value: unknown): { key: string | null; text: string | undefined; language: string | null };
  /** A preview texture; while loading, the view is rebuilt once it is ready. */
  image(path: string, view: NodeView): Texture | "loading" | "error";
}

export class NodeView {
  readonly container = new Container();
  width = MIN_WIDTH;
  height = 0;
  ports: PortLayout[] = [];
  controls: Control[] = [];
  /** True when a field shows other nodes' data (item references) and must follow their changes. */
  hasReferences = false;
  /** Localization keys shown by this node, to refresh it when their texts change. */
  localizedKeys = new Set<string>();
  hasUnnamedTexts = false;

  selected = false;
  /** Another view of the same node is selected. */
  linkHighlighted = false;
  hovered = false;
  hoveredPortId: string | null = null;
  hoveredControl: string | null = null;
  hoveredSegment: number | null = null;
  /** Set when the node must be redrawn once it becomes visible again. */
  stale = false;
  /** Set when the node must be rebuilt once it becomes visible again. */
  staleLayout = false;

  private readonly background = new Graphics();
  private readonly detail = new Container();
  /** Zoom of the zoomed-out look (colored block + name), or null while details are shown. */
  overviewZoom: number | null = null;
  private overviewLabel: BitmapText | null = null;
  private readonly portsById = new Map<string, PortLayout>();
  private portsBottom = HEADER_HEIGHT;
  private itemRects: Rect[] = [];
  /** Node-local rectangle of the "?" icon, or null when the schema has no description. */
  infoRect: Rect | null = null;
  private previewRects: Rect[] = [];

  /** The node id for the node itself, the alias id for a linked copy. */
  readonly viewId: string;

  constructor(
    readonly node: NodeModel,
    private readonly context: NodeViewContext,
    readonly alias: NodeAlias | null = null,
  ) {
    this.viewId = alias?.id ?? node.id;
    this.container.addChild(this.background, this.detail);
    this.rebuild();
    this.syncPosition();
  }

  get position(): Vec2 {
    return this.alias?.position ?? this.node.position;
  }

  get rect(): Rect {
    return { x: this.position.x, y: this.position.y, width: this.width, height: this.height };
  }

  get headerHeight(): number {
    return HEADER_HEIGHT;
  }

  syncPosition(): void {
    this.container.position.set(this.position.x, this.position.y);
  }

  /**
   * Zoomed out (`zoom` given), texts and controls are unreadable: the node becomes a block in its
   * category color with its name at a fixed screen size. Null shows the details again.
   */
  setOverview(zoom: number | null): void {
    const modeChanged = (zoom === null) !== (this.overviewZoom === null);
    this.overviewZoom = zoom;
    this.detail.visible = zoom === null;
    this.updateOverviewLabel();
    if (modeChanged) {
      this.redraw();
    }
  }

  private updateOverviewLabel(): void {
    const zoom = this.overviewZoom;
    if (zoom === null) {
      if (this.overviewLabel) this.overviewLabel.visible = false;
      return;
    }
    if (!this.overviewLabel) {
      this.overviewLabel = this.container.addChild(makeText("", OVERVIEW_TEXT_SIZE, theme.textPrimary, true));
    }
    const label = this.overviewLabel;
    const available = this.width * zoom - 8;
    // A name cut down to a couple of letters says nothing: then the block stays plain.
    const fitted = available > OVERVIEW_TEXT_SIZE ? fitText(this.node.displayName, available, OVERVIEW_TEXT_SIZE, true) : "";
    label.text = fitted === this.node.displayName || fitted.length >= 4 ? fitted : "";
    label.visible = label.text !== "";
    label.scale.set(1 / zoom);
    label.position.set((this.width - label.width) / 2, (this.height - label.height) / 2);
  }

  portWorldPosition(portId: string): Vec2 | null {
    const layout = this.portsById.get(portId);
    return layout ? { x: this.position.x + layout.x, y: this.position.y + layout.y } : null;
  }

  /** Recreates texts, controls and layout from the node's schema, data and ports. */
  rebuild(): void {
    for (const child of this.detail.removeChildren()) {
      child.destroy();
    }
    this.portsById.clear();
    this.controls = [];
    this.itemRects = [];
    this.previewRects = [];
    this.hasReferences = false;
    this.localizedKeys = new Set();
    this.hasUnnamedTexts = false;
    this.staleLayout = false;

    const node = this.node;
    const fields = node.schema?.fields ?? [];
    const width = this.measureWidth(fields);
    this.width = width;

    // Header
    let right = width - 12;
    this.infoRect = null;
    if (node.schema?.description) {
      this.infoRect = { x: right - INFO_SIZE, y: Math.round((HEADER_HEIGHT - INFO_SIZE) / 2), width: INFO_SIZE, height: INFO_SIZE };
      const mark = this.detail.addChild(makeText("?", SMALL_SIZE, theme.textPrimary, true));
      mark.position.set(
        Math.round(this.infoRect.x + (INFO_SIZE - mark.width) / 2),
        Math.round(this.infoRect.y + (INFO_SIZE - mark.height) / 2),
      );
      right -= INFO_SIZE + INFO_GAP;
    }
    const badgeLabel = this.badgeLabel();
    if (badgeLabel) {
      const badge = this.detail.addChild(makeText(badgeLabel, SMALL_SIZE, this.alias ? theme.linkText : theme.textSecondary));
      badge.position.set(Math.round(right - badge.width), Math.round((HEADER_HEIGHT - badge.height) / 2));
      right -= badge.width + BADGE_GAP;
    }
    const titleSpace = right - 12;
    const title = this.detail.addChild(makeText(fitText(node.displayName, titleSpace, 13, true), 13, theme.textPrimary, true));
    title.position.set(12, Math.round((HEADER_HEIGHT - title.height) / 2));
    const typeLabel = this.typeLabel();
    const typeSpace = titleSpace - title.width - TYPE_GAP;
    if (typeLabel && typeSpace > 24) {
      const type = this.detail.addChild(makeText(fitText(typeLabel, typeSpace, 12), 12, theme.textSecondary));
      type.position.set(12 + title.width + TYPE_GAP, Math.round((HEADER_HEIGHT - type.height) / 2));
    }

    // Ports that repeat per list element sit on their element's row; the rest go to the port band.
    const alignedLists = this.alignedLists();
    const aligned = (port: Port) => alignedLists.has(port.key.split(":")[0]) && port.key.includes(":");
    const bandInputs = node.inputs.filter((port) => !aligned(port));
    const bandOutputs = node.outputs.filter((port) => !aligned(port));
    const rows = Math.max(bandInputs.length, bandOutputs.length, fields.length > 0 && !node.isPlaceholder ? 0 : 1);
    const portsTop = HEADER_HEIGHT + PORTS_PADDING;
    const rowCenter = (index: number) => portsTop + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT / 2;
    this.ports = [];
    bandInputs.forEach((port, index) => this.placePort(port, 0, rowCenter(index)));
    bandOutputs.forEach((port, index) => this.placePort(port, width, rowCenter(index)));
    this.portsBottom = rows > 0 ? portsTop + rows * PORT_ROW_HEIGHT + PORTS_PADDING : HEADER_HEIGHT;
    let y = this.portsBottom;

    // Fields
    const rowCenters = new Map<string, number>();
    if (node.isPlaceholder) {
      const note = this.detail.addChild(makeText("Schema not found. The node data is kept as-is.", SMALL_SIZE, theme.textMuted));
      note.position.set(BODY_PADDING, y + BODY_PADDING);
      y += BODY_PADDING * 2 + FIELD_HEIGHT;
    } else if (fields.length > 0) {
      y += BODY_PADDING;
      const labelWidth = scalarLabelWidth(fields);
      const contentWidth = width - BODY_PADDING * 2;
      for (const field of fields) {
        // A variant (e.g. an emotion) is only offered once its resource is chosen.
        if (field.type === "resourceVariant" && typeof node.data[field.source] !== "string") continue;
        y += this.layoutField([field.id], field, BODY_PADDING, y, contentWidth, labelWidth, rowCenters) + FIELD_GAP;
        const preview = previewFor(field, fields, node.data, this.context.resources());
        if (preview) {
          y += this.layoutPreview(preview.resource, preview.variant, BODY_PADDING, y, contentWidth) + FIELD_GAP;
        }
      }
      y += BODY_PADDING - FIELD_GAP;
    }

    for (const port of node.ports) {
      if (aligned(port)) {
        const center = rowCenters.get(`${port.key.split(":")[0]}:${port.key.slice(port.key.indexOf(":") + 1)}`);
        this.placePort(port, port.direction === "Input" ? 0 : width, center ?? HEADER_HEIGHT + PORT_ROW_HEIGHT / 2);
      }
    }

    this.height = Math.max(y, HEADER_HEIGHT + PORT_ROW_HEIGHT);
    this.redraw();
    this.updateOverviewLabel();
  }

  redraw(): void {
    const g = this.background;
    const { width, height } = this;
    const accent = this.node.schema?.color ?? null;
    g.clear();

    if (this.overviewZoom !== null) {
      // Zoomed out: one block in the category color, see `setOverview`.
      g.roundRect(0, 0, width, height, CORNER_RADIUS).fill(
        this.node.isPlaceholder ? theme.placeholderHeader : accent !== null ? mix(theme.nodeHeader, accent, 0.7) : theme.nodeHeader,
      );
    } else {
      this.drawDetail(g, accent);
    }
    this.drawOutline(g);
  }

  private drawDetail(g: Graphics, accent: number | null): void {
    const { width, height } = this;
    section(g, 0, 0, width, height, CORNER_RADIUS, CORNER_RADIUS).fill(theme.nodeBackground);
    section(g, 0, 0, width, HEADER_HEIGHT, CORNER_RADIUS, 0).fill(
      this.node.isPlaceholder ? theme.placeholderHeader : accent !== null ? mix(theme.nodeHeader, accent, 0.45) : theme.nodeHeader,
    );
    if (accent !== null) {
      g.rect(0, HEADER_HEIGHT - 2, width, 2).fill(accent);
    }
    if (this.portsBottom > HEADER_HEIGHT) {
      const bandHeight = this.portsBottom - HEADER_HEIGHT;
      section(g, 0, HEADER_HEIGHT, width, bandHeight, 0, this.portsBottom >= height ? CORNER_RADIUS : 0).fill(theme.nodePorts);
    }
    if (this.infoRect) {
      const { x, y, width: size } = this.infoRect;
      const hovered = this.hoveredControl === INFO_KEY;
      g.circle(x + size / 2, y + size / 2, size / 2).fill({ color: 0x000000, alpha: hovered ? 0.45 : 0.22 });
    }
    for (const rect of this.itemRects) {
      g.roundRect(rect.x, rect.y, rect.width, rect.height, 4).fill(theme.listItemBackground);
    }
    for (const rect of this.previewRects) {
      g.roundRect(rect.x, rect.y, rect.width, rect.height, 4).fill(theme.previewBackground);
    }

    for (const control of this.controls) {
      this.drawControl(g, control);
    }
  }

  /** Border, linked-copy frame and port dots, drawn in both looks. */
  private drawOutline(g: Graphics): void {
    const { width, height } = this;
    const borderColor = this.selected
      ? theme.nodeBorderSelected
      : this.linkHighlighted
        ? theme.linkHighlight
        : this.hovered
          ? theme.nodeBorderHover
          : theme.nodeBorder;
    const borderWidth = this.selected || this.linkHighlighted ? 2 : 1;
    g.roundRect(0, 0, width, height, CORNER_RADIUS).stroke({ width: borderWidth, color: borderColor, alignment: 1 });
    if (this.alias) {
      // A linked copy sits in an outer frame, so it cannot be mistaken for the node itself.
      const inset = -ALIAS_FRAME_GAP;
      g.roundRect(inset, inset, width - inset * 2, height - inset * 2, CORNER_RADIUS + ALIAS_FRAME_GAP).stroke({
        width: ALIAS_FRAME_WIDTH,
        color: this.hovered || this.selected ? theme.aliasBorderHover : theme.aliasBorder,
        alignment: 0,
      });
    }

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
      if (this.context.isPortOnChoiceRoute(port.id)) {
        g.circle(x, y, radius + 3).stroke({ width: 1.75, color: theme.choiceRoute, alpha });
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
    if (this.overviewZoom !== null) {
      // Zoomed out, controls are hidden: the node only moves and connects.
      return { kind: localY <= HEADER_HEIGHT ? "header" : "body" };
    }
    if (this.infoRect && contains(this.infoRect, localX, localY)) {
      return { kind: "info" };
    }
    if (localY <= HEADER_HEIGHT) {
      return { kind: "header" };
    }
    for (const control of this.controls) {
      const rect = control.type === "field" ? control.hitRect : control.rect;
      if (!contains(rect, localX, localY)) continue;
      if (control.type === "field" && control.kind === "readonly") continue;
      if (control.type === "button" && !control.enabled) continue;
      const segment = control.type === "field" ? (control.segments?.findIndex((r) => contains(r, localX, localY)) ?? -1) : -1;
      return { kind: "control", control, segment: segment >= 0 ? segment : null };
    }
    return { kind: "body" };
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  // --- Layout --------------------------------------------------------------------------------

  private placePort(port: Port, x: number, y: number): void {
    const layout = { port, x, y };
    const labelWidth = this.width / 2 - PORT_LABEL_OFFSET - 6;
    const label = this.detail.addChild(makeText(fitText(port.displayName, labelWidth, 12), 12, theme.textPort));
    const labelX = x === 0 ? PORT_LABEL_OFFSET : this.width - PORT_LABEL_OFFSET - label.width;
    // Ports placed on list rows keep their label outside the row content.
    label.position.set(Math.round(labelX), Math.round(y - label.height / 2));
    if (this.alignedLists().has(port.key.split(":")[0]) && port.key.includes(":")) {
      label.visible = false;
    }
    this.ports.push(layout);
    this.portsById.set(port.id, layout);
  }

  /** Port ids whose repeat list is displayed as a top-level list field. */
  private alignedLists(): Set<string> {
    const result = new Set<string>();
    for (const port of this.node.schema?.ports ?? []) {
      if (port.repeat && "list" in port.repeat && this.node.schema!.fields.some((field) => field.id === (port.repeat as { list: string }).list)) {
        result.add(port.id);
      }
    }
    return result;
  }

  /** "↗ link" on a linked copy; "↗ N" on a node that has N linked copies. */
  private badgeLabel(): string | null {
    if (this.alias) {
      return "↗ link";
    }
    const count = this.context.aliasCount();
    return count > 0 ? `↗ ${count}` : null;
  }

  /** "(Line)" after a custom name, so named nodes still show what they are. */
  private typeLabel(): string | null {
    const schema = this.node.schema;
    return schema && this.node.displayName !== schema.title ? `(${schema.title})` : null;
  }

  private measureWidth(fields: FieldSchema[]): number {
    const node = this.node;
    const maxLabel = (ports: Port[]) => ports.reduce((max, port) => Math.max(max, measureText(port.displayName, 12)), 0);
    const typeLabel = this.typeLabel();
    const badgeLabel = this.badgeLabel();
    const titleWidth =
      measureText(node.displayName, 13, true) +
      (typeLabel ? TYPE_GAP + measureText(typeLabel, 12) : 0) +
      (badgeLabel ? BADGE_GAP + measureText(badgeLabel, SMALL_SIZE) : 0) +
      (node.schema?.description ? INFO_GAP + INFO_SIZE : 0);
    let width = Math.max(MIN_WIDTH, titleWidth + 40);
    width = Math.max(width, maxLabel(node.inputs) + maxLabel(node.outputs) + PORT_LABEL_OFFSET * 2 + 24);
    const labelWidth = scalarLabelWidth(fields);
    let limit = MAX_WIDTH;
    for (const field of fields) {
      const needed = BODY_PADDING * 2 + fieldWidth(field, labelWidth);
      width = Math.max(width, needed);
      if (field.type === "matrix") {
        const columns = dimensionKeys(node.data, field.columns).length;
        const rows = dimensionKeys(node.data, field.rows);
        const rowLabel = rows.reduce((max, _, index) => Math.max(max, measureText(this.dimensionLabel(field, "rows", index), SMALL_SIZE)), 0);
        width = Math.max(width, BODY_PADDING * 2 + rowLabel + 8 + columns * (CELL_SIZE + CELL_GAP));
        limit = MAX_MATRIX_WIDTH;
      }
    }
    return Math.ceil(Math.min(limit, width));
  }

  /** Lays out one field at `path`; returns its height. */
  private layoutField(
    path: DataPath,
    field: FieldSchema,
    x: number,
    y: number,
    width: number,
    labelWidth: number,
    rowCenters: Map<string, number>,
    showLabel = true,
  ): number {
    if (field.type === "list") {
      return this.layoutList(path, field, x, y, width, rowCenters);
    }
    if (field.type === "matrix") {
      return this.layoutMatrix(path, field, x, y, width);
    }
    if (field.type === "record") {
      const childLabel = scalarLabelWidth(field.fields);
      let height = 0;
      for (const child of field.fields) {
        height += this.layoutField([...path, child.id], child, x, y + height, width, childLabel, rowCenters) + ITEM_GAP;
      }
      return Math.max(0, height - ITEM_GAP);
    }

    const kind = fieldKind(field);
    const tall = isTall(field);
    // Tall boxes take the full width (the label is above), so the text wraps to `width - 16`.
    const lines = tall ? Math.max(MULTILINE_LINES, wrapLines(this.boxText(field, path), width - 16, Infinity).length) : 1;
    const height = tall ? FIELD_HEIGHT + LINE_HEIGHT * (lines - 1) : FIELD_HEIGHT;
    const key = path.join(".");
    if (kind === "bool") {
      const label = this.detail.addChild(makeText(fitText(field.label, width - 28, LABEL_SIZE), LABEL_SIZE, theme.textSecondary));
      label.position.set(x + 24, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
      const control: Control = { type: "field", key, path, field, kind, hitRect: { x, y, width: Math.min(width, 28 + label.width), height } };
      this.controls.push(control);
      this.addValueTexts(control);
      return height;
    }

    let boxX = x;
    let boxY = y;
    if (showLabel && tall) {
      // Text boxes take the full width, with the label (and the localization key) on a row above.
      const label = this.detail.addChild(makeText(fitText(field.label, width, LABEL_SIZE), LABEL_SIZE, theme.textSecondary));
      label.position.set(x, y);
      if (kind === "localized") {
        const { key: textKey } = this.context.localizedText(field as LocalizedTextField, path, getIn(this.node.data, path));
        if (textKey) {
          const keyText = this.detail.addChild(makeText(fitText(`(${textKey})`, width - label.width - 6, SMALL_SIZE), SMALL_SIZE, theme.textMuted));
          keyText.position.set(Math.round(x + label.width + 6), Math.round(y + (label.height - keyText.height) / 2));
        }
      }
      boxY = y + TALL_LABEL_HEIGHT;
    } else if (showLabel) {
      const label = this.detail.addChild(makeText(fitText(field.label, width / 2, LABEL_SIZE), LABEL_SIZE, theme.textSecondary));
      label.position.set(x, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
      boxX = x + Math.min(labelWidth, width / 2) + LABEL_GAP;
    }
    const box = { x: boxX, y: boxY, width: x + width - boxX, height };
    const control: Control & { type: "field" } = { type: "field", key, path, field, kind, hitRect: box };
    if (kind === "segmented") {
      const options = (field as EnumField).options;
      const weights = options.map((option) => measureText(option.label, VALUE_SIZE) + 16);
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      let segmentX = box.x;
      control.segments = weights.map((weight) => {
        const segmentWidth = (box.width * weight) / total;
        const segment = { x: segmentX, y: box.y, width: segmentWidth, height: box.height };
        segmentX += segmentWidth;
        return segment;
      });
    }
    if (kind === "reference") {
      this.hasReferences = true;
    }
    this.controls.push(control);
    this.addValueTexts(control);
    return boxY - y + height;
  }

  private layoutList(path: DataPath, field: ListField, x: number, y: number, width: number, rowCenters: Map<string, number>): number {
    const items = getIn(this.node.data, path);
    const list = Array.isArray(items) ? items : [];
    const full = field.maxItems !== undefined && list.length >= field.maxItems;
    const key = path.join(".");

    const label = this.detail.addChild(makeText(fitText(field.label, width - 60, LABEL_SIZE), LABEL_SIZE, theme.textSecondary, true));
    label.position.set(x, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
    const count = this.detail.addChild(
      makeText(field.maxItems !== undefined ? `${list.length}/${field.maxItems}` : String(list.length), SMALL_SIZE, theme.textMuted),
    );
    count.position.set(Math.round(x + label.width + 6), Math.round(y + (FIELD_HEIGHT - count.height) / 2));
    this.addButton(`${key}+`, { x: x + width - BUTTON_SIZE, y: y + 3, width: BUTTON_SIZE, height: BUTTON_SIZE }, "+", { type: "add", path }, !full);

    let cursor = y + FIELD_HEIGHT + ITEM_GAP;
    if (list.length === 0) {
      const empty = this.detail.addChild(makeText("No items", SMALL_SIZE, theme.textMuted));
      empty.position.set(x + ITEM_INDENT, Math.round(cursor + (FIELD_HEIGHT - empty.height) / 2));
      return cursor + FIELD_HEIGHT - y;
    }

    const contentX = x + ITEM_INDENT;
    const contentWidth = width - ITEM_INDENT - ITEM_BUTTONS_WIDTH;
    list.forEach((item, index) => {
      const itemTop = cursor;
      const itemPath = [...path, index];
      const itemKey = isRecord(item) && typeof item.id === "string" ? item.id : String(index);
      const badge = this.detail.addChild(makeText(String(index + 1), SMALL_SIZE, theme.textMuted));
      badge.position.set(Math.round(x + (ITEM_INDENT - badge.width) / 2 - 2), Math.round(cursor + (FIELD_HEIGHT - badge.height) / 2));

      const buttonsX = x + width - ITEM_BUTTONS_WIDTH + 4;
      const button = (offset: number) => ({ x: buttonsX + offset * (BUTTON_SIZE + BUTTON_GAP), y: cursor + 3, width: BUTTON_SIZE, height: BUTTON_SIZE });
      this.addButton(`${key}.${index}↑`, button(0), "↑", { type: "move", path, index, delta: -1 }, index > 0);
      this.addButton(`${key}.${index}↓`, button(1), "↓", { type: "move", path, index, delta: 1 }, index < list.length - 1);
      this.addButton(`${key}.${index}×`, button(2), "×", { type: "remove", path, index }, list.length > field.minItems);

      const labelWidth = field.item.type === "record" ? scalarLabelWidth(field.item.fields) : 0;
      const height = this.layoutField(itemPath, field.item, contentX, cursor, contentWidth, labelWidth, rowCenters, field.item.type === "record");
      const itemHeight = Math.max(FIELD_HEIGHT, height);
      this.itemRects.push({ x: x - 3, y: itemTop - 2, width: width + 6, height: itemHeight + 4 });
      rowCenters.set(`${path[path.length - 1]}:${itemKey}`, itemTop + FIELD_HEIGHT / 2);
      cursor += itemHeight + ITEM_GAP + 4;
    });
    // Ports repeat per element of top-level lists; they are keyed `<port id>:<element>`, see derivePorts.
    for (const port of this.node.schema?.ports ?? []) {
      if (port.repeat && "list" in port.repeat && port.repeat.list === path[0]) {
        list.forEach((item, index) => {
          const itemKey = isRecord(item) && typeof item.id === "string" ? item.id : String(index);
          const center = rowCenters.get(`${path[0]}:${itemKey}`);
          if (center !== undefined) rowCenters.set(`${port.id}:${itemKey}`, center);
        });
      }
    }
    return cursor - ITEM_GAP - 4 - y;
  }

  private layoutMatrix(path: DataPath, field: MatrixField, x: number, y: number, width: number): number {
    const rows = dimensionKeys(this.node.data, field.rows);
    const columns = dimensionKeys(this.node.data, field.columns);
    const label = this.detail.addChild(makeText(field.label, LABEL_SIZE, theme.textSecondary, true));
    label.position.set(x, Math.round(y + (FIELD_HEIGHT - label.height) / 2));
    let cursor = y + FIELD_HEIGHT;
    if (rows.length === 0 || columns.length === 0) {
      const empty = this.detail.addChild(makeText("Empty: add rows and columns", SMALL_SIZE, theme.textMuted));
      empty.position.set(x, Math.round(cursor + (FIELD_HEIGHT - empty.height) / 2));
      return cursor + FIELD_HEIGHT - y;
    }
    const rowLabelWidth = rows.reduce((max, _, index) => Math.max(max, measureText(this.dimensionLabel(field, "rows", index), SMALL_SIZE)), 0) + 8;
    const step = CELL_SIZE + CELL_GAP;
    const gridX = x + Math.min(rowLabelWidth, width / 3);
    columns.forEach((_, column) => {
      const text = this.detail.addChild(
        makeText(fitText(this.dimensionLabel(field, "columns", column), step + 4, SMALL_SIZE), SMALL_SIZE, theme.textMuted),
      );
      text.position.set(Math.round(gridX + column * step + (CELL_SIZE - text.width) / 2), Math.round(cursor + 2));
    });
    cursor += 16;
    const values = getIn(this.node.data, path);
    rows.forEach((row, rowIndex) => {
      const text = this.detail.addChild(makeText(this.dimensionLabel(field, "rows", rowIndex), SMALL_SIZE, theme.textMuted));
      text.position.set(x, Math.round(cursor + (CELL_SIZE - text.height) / 2));
      columns.forEach((column, columnIndex) => {
        const rect = { x: gridX + columnIndex * step, y: cursor, width: CELL_SIZE, height: CELL_SIZE };
        this.controls.push({ type: "cell", key: `${path.join(".")}[${row}][${column}]`, rect, fieldId: String(path[0]), row, column });
        if (getIn(values, [row, column]) === true) {
          const check = this.detail.addChild(makeText("✓", 12, theme.textPrimary, true));
          check.position.set(Math.round(rect.x + (CELL_SIZE - check.width) / 2), Math.round(rect.y + (CELL_SIZE - check.height) / 2));
        }
      });
      cursor += step;
    });
    return cursor - CELL_GAP - y;
  }

  /** Image of the chosen resource (or of its chosen variant); returns the block height. */
  private layoutPreview(resource: ResourceField, variant: ResourceVariantField | null, x: number, y: number, width: number): number {
    const library = this.context.resources();
    const value = this.node.data[resource.id];
    const item = typeof value === "string" ? library?.items.get(value) : undefined;
    const note = (message: string, color: number = theme.textMuted, height = FIELD_HEIGHT) => {
      const text = this.detail.addChild(makeText(fitText(message, width - 16, SMALL_SIZE), SMALL_SIZE, color));
      text.position.set(Math.round(x + (width - text.width) / 2), Math.round(y + (height - text.height) / 2));
      return height;
    };
    if (!item) {
      return note(`${resource.label} is not selected`);
    }
    const variantId = variant ? this.node.data[variant.id] : null;
    const variantImage = variant ? item.variants.get(variant.collection)?.find((entry) => entry.id === variantId)?.image : null;
    const path = variantImage ?? item.image;
    const height = resource.previewHeight;
    this.previewRects.push({ x, y, width, height });
    if (!path) {
      return note("No image", theme.textMuted, height);
    }
    const texture = this.context.image(path, this);
    if (texture === "loading") {
      return note("Loading…", theme.textMuted, height);
    }
    if (texture === "error") {
      return note("⚠ Image not found", theme.textWarning, height);
    }
    const sprite = this.detail.addChild(new Sprite(texture));
    const scale = Math.min((width - 8) / texture.width, (height - 8) / texture.height);
    sprite.scale.set(scale);
    sprite.position.set(Math.round(x + (width - texture.width * scale) / 2), Math.round(y + (height - texture.height * scale) / 2));
    return height;
  }

  private dimensionLabel(field: MatrixField, dimension: "rows" | "columns", index: number): string {
    const source = this.node.data[field[dimension]];
    const item = Array.isArray(source) ? source[index] : null;
    return formatLabel(dimension === "rows" ? field.rowLabel : field.columnLabel, index, item);
  }

  private addButton(key: string, rect: Rect, glyph: string, action: ListAction, enabled: boolean): void {
    this.controls.push({ type: "button", key, rect, glyph, action, enabled });
    const text = this.detail.addChild(makeText(glyph, 12, enabled ? theme.textPrimary : theme.textDisabled, true));
    text.position.set(Math.round(rect.x + (rect.width - text.width) / 2), Math.round(rect.y + (rect.height - text.height) / 2) - 1);
  }

  private addValueTexts(control: Control & { type: "field" }): void {
    for (const text of this.createValueTexts(control)) {
      this.detail.addChild(text);
    }
  }

  /** The text a tall box shows: a multiline string, or a localized text in the shown language. */
  private boxText(field: FieldSchema, path: DataPath): string {
    const value = getIn(this.node.data, path);
    if (field.type === "localizedText") {
      return this.context.localizedText(field, path, value).text ?? "";
    }
    return typeof value === "string" ? value : "";
  }

  private createValueTexts(control: Control & { type: "field" }): BitmapText[] {
    const { field, kind, hitRect: box } = control;
    const value = getIn(this.node.data, control.path);
    const centerY = (text: BitmapText) => Math.round(box.y + (FIELD_HEIGHT - text.height) / 2);
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
      case "multiline":
        return wrapLines(typeof value === "string" ? value : "", inner, Infinity).map((line, index) => {
          const text = makeText(line, VALUE_SIZE, theme.textPrimary);
          text.position.set(box.x + 8, Math.round(box.y + 4 + index * LINE_HEIGHT));
          return text;
        });
      case "bool":
        return value === true ? [positioned(makeText("✓", 13, theme.textPrimary, true), box.x + 4, box.y + 3)] : [];
      case "dropdown": {
        const option = (field as EnumField).options.find((candidate) => candidate.value === value);
        const text = makeText(fitText(option?.label ?? String(value ?? ""), inner - 12, VALUE_SIZE), VALUE_SIZE, theme.textPrimary);
        text.position.set(box.x + 8, centerY(text));
        return [text, this.arrow(box)];
      }
      case "reference": {
        const label = typeof value === "string" ? this.context.referenceLabel(field, value) : null;
        const missing = typeof value === "string" && label === null;
        const content = missing ? `⚠ missing ${field.type === "nodeRef" ? "node" : "element"}` : label ?? "None";
        const color = missing ? theme.textWarning : label ? theme.textPrimary : theme.textMuted;
        const text = makeText(fitText(content, inner - 12, VALUE_SIZE), VALUE_SIZE, color);
        text.position.set(box.x + 8, centerY(text));
        return [text, this.arrow(box)];
      }
      case "localized": {
        const localized = this.context.localizedText(field as LocalizedTextField, control.path, value);
        if (!localized.key) {
          this.hasUnnamedTexts = true;
          const text = makeText(fitText("Name the node to write text", inner, SMALL_SIZE), SMALL_SIZE, theme.textMuted);
          text.position.set(box.x + 8, centerY(text));
          return [text];
        }
        this.localizedKeys.add(localized.key);
        if (!localized.text) {
          const empty = makeText(`No ${localized.language ?? ""} text`.replace("  ", " "), SMALL_SIZE, theme.textMuted);
          empty.position.set(box.x + 8, Math.round(box.y + 5));
          return [empty];
        }
        const lines = (field as LocalizedTextField).multiline ? Infinity : 1;
        const texts = wrapLines(localized.text, inner, lines).map((line, index) => {
          const text = makeText(line, VALUE_SIZE, theme.textPrimary);
          text.position.set(box.x + 8, Math.round(box.y + 4 + index * LINE_HEIGHT));
          return text;
        });
        return texts;
      }
      case "resource": {
        const item = typeof value === "string" ? this.context.resources()?.items.get(value) : undefined;
        const missing = typeof value === "string" && !item;
        const content = missing ? "⚠ missing resource" : item?.name ?? "None";
        const color = missing ? theme.textWarning : item ? theme.textPrimary : theme.textMuted;
        const text = makeText(fitText(content, inner - 12, VALUE_SIZE), VALUE_SIZE, color);
        text.position.set(box.x + 8, centerY(text));
        return [text, this.arrow(box)];
      }
      case "variant": {
        const variantField = field as ResourceVariantField;
        const source = this.node.data[variantField.source];
        const item = typeof source === "string" ? this.context.resources()?.items.get(source) : undefined;
        const variant = item?.variants.get(variantField.collection)?.find((entry) => entry.id === value);
        const content = variant?.label ?? (typeof value === "string" ? value : "—");
        const text = makeText(fitText(content, inner - 12, VALUE_SIZE), VALUE_SIZE, variant ? theme.textPrimary : theme.textMuted);
        text.position.set(box.x + 8, centerY(text));
        return [text, this.arrow(box)];
      }
      case "segmented":
        return (field as EnumField).options.map((option, index) => {
          const segment = control.segments![index];
          const text = makeText(option.label, VALUE_SIZE, option.value === value ? theme.textPrimary : theme.textSecondary);
          text.position.set(Math.round(segment.x + (segment.width - text.width) / 2), centerY(text));
          return text;
        });
      case "readonly": {
        const summary = field.type === "unsupported" ? `${field.declaredType}: not supported yet` : "—";
        const text = makeText(fitText(summary, inner, SMALL_SIZE), SMALL_SIZE, theme.textMuted);
        text.position.set(box.x + 8, centerY(text));
        return [text];
      }
    }
  }

  private arrow(box: Rect): BitmapText {
    const arrow = makeText("▾", VALUE_SIZE, theme.textMuted);
    arrow.position.set(Math.round(box.x + box.width - 8 - arrow.width), Math.round(box.y + (FIELD_HEIGHT - arrow.height) / 2));
    return arrow;
  }

  // --- Drawing -------------------------------------------------------------------------------

  private drawControl(g: Graphics, control: Control): void {
    const hovered = this.hoveredControl === control.key;
    const border = hovered ? theme.nodeBorderHover : theme.widgetBorder;

    if (control.type === "button") {
      const fill = !control.enabled ? theme.buttonDisabled : hovered ? theme.buttonHover : theme.buttonBackground;
      g.roundRect(control.rect.x, control.rect.y, control.rect.width, control.rect.height, 3).fill(fill);
      return;
    }
    if (control.type === "cell") {
      const checked = getIn(this.node.data, [control.fieldId, control.row, control.column]) === true;
      g.roundRect(control.rect.x, control.rect.y, control.rect.width, control.rect.height, 3)
        .fill(checked ? theme.checkboxChecked : theme.widgetBackground)
        .stroke({ width: 1, color: border, alignment: 1 });
      return;
    }

    const box = control.hitRect;
    switch (control.kind) {
      case "bool": {
        const checked = getIn(this.node.data, control.path) === true;
        g.roundRect(box.x + 1, box.y + 5, 14, 14, 3)
          .fill(checked ? theme.checkboxChecked : theme.widgetBackground)
          .stroke({ width: 1, color: border, alignment: 1 });
        return;
      }
      case "segmented": {
        const value = getIn(this.node.data, control.path);
        const options = (control.field as EnumField).options;
        g.roundRect(box.x, box.y, box.width, box.height, 4).fill(theme.widgetBackground);
        control.segments!.forEach((segment, index) => {
          const active = options[index].value === value;
          if (active || (hovered && this.hoveredSegment === index)) {
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
        g.roundRect(box.x, box.y, box.width, box.height, 4).fill(theme.widgetBackground).stroke({ width: 1, color: border, alignment: 1 });
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
    case "itemRef":
    case "nodeRef":
      return "reference";
    case "resource":
      return "resource";
    case "localizedText":
      return "localized";
    case "resourceVariant":
      return "variant";
    default:
      return "readonly";
  }
}

export function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Number(value.toFixed(4))) : "—";
}

/**
 * Which resource preview (if any) follows `field`: after a resource field, or — when a variant field
 * of that resource is shown — after the variant field, so the image reflects the chosen variant.
 */
function previewFor(
  field: FieldSchema,
  fields: FieldSchema[],
  data: Record<string, unknown>,
  library: ResourceLibrary | null,
): { resource: ResourceField; variant: ResourceVariantField | null } | null {
  const hasImages = (resource: ResourceField) =>
    resource.previewHeight > 0 && (library?.types.get(resource.resourceType)?.media ?? "image") === "image";
  if (field.type === "resource") {
    if (!hasImages(field)) return null;
    const variantShown = typeof data[field.id] === "string" && fields.some((other) => other.type === "resourceVariant" && other.source === field.id);
    return variantShown ? null : { resource: field, variant: null };
  }
  if (field.type === "resourceVariant") {
    const source = fields.find((other) => other.id === field.source);
    return source?.type === "resource" && hasImages(source) ? { resource: source, variant: field } : null;
  }
  return null;
}

/** Width of the widest label among fields shown as "label: value" rows. */
function scalarLabelWidth(fields: FieldSchema[]): number {
  return fields.reduce((max, field) => {
    const kind = fieldKind(field);
    const labelled = field.type !== "list" && field.type !== "matrix" && field.type !== "record" && kind !== "bool" && !isTall(field);
    return labelled ? Math.max(max, measureText(field.label, LABEL_SIZE)) : max;
  }, 0);
}

/** Multiline text fields: drawn full width under their label. */
function isTall(field: FieldSchema): boolean {
  const kind = fieldKind(field);
  return kind === "multiline" || (kind === "localized" && (field as LocalizedTextField).multiline);
}

/** Minimum content width a field needs. */
function fieldWidth(field: FieldSchema, labelWidth: number): number {
  if (isTall(field)) {
    return Math.max(MIN_VALUE_WIDTH, measureText(field.label, LABEL_SIZE));
  }
  switch (field.type) {
    case "list": {
      const item = field.item.type === "record" ? scalarLabelWidth(field.item.fields) + LABEL_GAP : 0;
      const nested = field.item.type === "record" ? Math.max(0, ...field.item.fields.map((child) => fieldWidth(child, 0))) : MIN_VALUE_WIDTH;
      return ITEM_INDENT + item + Math.max(MIN_VALUE_WIDTH, nested) + ITEM_BUTTONS_WIDTH;
    }
    case "record":
      return Math.max(0, ...field.fields.map((child) => fieldWidth(child, scalarLabelWidth(field.fields))));
    case "matrix":
      return 0;
    case "bool":
      return 28 + measureText(field.label, LABEL_SIZE);
    case "enum":
      if (field.display === "segmented") {
        return labelWidth + LABEL_GAP + field.options.reduce((sum, option) => sum + measureText(option.label, VALUE_SIZE) + 16, 0);
      }
      return labelWidth + LABEL_GAP + MIN_VALUE_WIDTH;
    default:
      return labelWidth + LABEL_GAP + MIN_VALUE_WIDTH;
  }
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
