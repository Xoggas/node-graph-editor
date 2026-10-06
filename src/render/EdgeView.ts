import { FillGradient, Graphics } from "pixi.js";
import type { Connection } from "../graph/types";
import type { Vec2 } from "../graph/types";
import { type Bounds, type EdgePath, edgeBounds, ROUTE_CORNER_RADIUS, samplePath, translatePath } from "./geometry";
import { theme } from "./theme";

const EDGE_WIDTH = 2.25;
const FOCUSED_EDGE_WIDTH = 3.25;
const SELECTED_EDGE_WIDTH = 4;
/** Opacity of edges that do not touch the focused nodes. */
const DIMMED_ALPHA = 0.18;
/** Dash and gap (world px at 100%) of edges drawn dashed. */
const DASH = 10;
const GAP = 6;

/**
 * How an edge relates to the focused nodes (the selection, else the hovered node): it touches one, it does
 * not, or nothing is focused.
 */
export type EdgeFocus = "none" | "focused" | "dimmed";

export class EdgeView {
  readonly graphics = new Graphics();
  path: EdgePath | null = null;
  bounds: Bounds = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
  selected = false;
  /** On a route from a line to a choice it shows (see `choiceRouteConnections`). */
  dashed = false;
  private focus: EdgeFocus = "none";

  /**
   * @param fromColor color at the output end (the source node's color)
   * @param toColor color at the input end (the target node's color); the edge blends from one to the other
   */
  constructor(
    readonly connection: Connection,
    private readonly fromColor: number,
    private readonly toColor: number,
  ) {}

  /**
   * Dimming is the object's alpha, so it applies at once to every edge without redrawing; only the width of
   * focused edges changes the geometry. Returns whether the edge has to be redrawn.
   */
  setFocus(focus: EdgeFocus): boolean {
    if (this.focus === focus) return false;
    const widthChanged = (this.focus === "focused") !== (focus === "focused");
    this.focus = focus;
    this.applyAlpha();
    return widthChanged;
  }

  private applyAlpha(): void {
    this.graphics.alpha = this.focus === "dimmed" && !this.selected ? DIMMED_ALPHA : 1;
  }

  update(path: EdgePath | null, scale: number): void {
    this.path = path;
    this.graphics.position.set(0, 0);
    this.redraw(scale);
  }

  /** Moves the edge without rebuilding its geometry (both endpoints moved by the same delta). */
  translate(dx: number, dy: number): void {
    if (!this.path) {
      return;
    }
    this.path = translatePath(this.path, dx, dy);
    this.bounds = {
      minX: this.bounds.minX + dx,
      minY: this.bounds.minY + dy,
      maxX: this.bounds.maxX + dx,
      maxY: this.bounds.maxY + dy,
    };
    this.graphics.position.set(this.graphics.position.x + dx, this.graphics.position.y + dy);
  }

  redraw(scale: number): void {
    const g = this.graphics;
    g.clear();
    if (!this.path) {
      this.bounds = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
      return;
    }
    const width = (this.selected ? SELECTED_EDGE_WIDTH : this.focus === "focused" ? FOCUSED_EDGE_WIDTH : EDGE_WIDTH) * scale;
    // Geometry is drawn in world coordinates; undo any pending translation offset first.
    const { x: offsetX, y: offsetY } = this.graphics.position;
    const path = offsetX === 0 && offsetY === 0 ? this.path : translatePath(this.path, -offsetX, -offsetY);
    if (this.dashed) {
      dashedLine(g, samplePath(path, 48), DASH * scale, GAP * scale);
    } else {
      traceEdgePath(g, path);
    }
    this.applyAlpha();
    if (this.selected) {
      g.stroke({ width, color: theme.connectionSelected, cap: "round", join: "round" });
    } else if (this.dashed) {
      g.stroke({ width, color: theme.choiceRoute, cap: "round", join: "round" });
    } else if (this.fromColor === this.toColor) {
      g.stroke({ width, color: this.fromColor, cap: "round", join: "round" });
    } else {
      // The gradient runs left to right over the edge's bounds; flip it when the edge runs right to left.
      const leftToRight = endPoint(path).x >= startPoint(path).x;
      const fill = leftToRight ? gradient(this.fromColor, this.toColor) : gradient(this.toColor, this.fromColor);
      g.stroke({ width, fill, cap: "round", join: "round" });
    }
    this.bounds = edgeBounds(this.path, width);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}

/** Left-to-right gradients by color pair, shared by all edges (each one is a texture). */
const gradients = new Map<string, FillGradient>();

function gradient(left: number, right: number): FillGradient {
  const key = `${left}:${right}`;
  let fill = gradients.get(key);
  if (!fill) {
    fill = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      colorStops: [
        { offset: 0, color: left },
        { offset: 1, color: right },
      ],
      textureSpace: "local",
    });
    gradients.set(key, fill);
  }
  return fill;
}

function startPoint(path: EdgePath): Vec2 {
  return path.kind === "bezier" ? path.start : path.points[0];
}

function endPoint(path: EdgePath): Vec2 {
  return path.kind === "bezier" ? path.end : path.points[path.points.length - 1];
}

/** Adds dashes along a polyline to the graphics path (stroke it afterwards). */
function dashedLine(g: Graphics, points: Vec2[], dash: number, gap: number): void {
  let drawing = true;
  let left = dash;
  for (let i = 1; i < points.length; i++) {
    let from = points[i - 1];
    const to = points[i];
    let length = Math.hypot(to.x - from.x, to.y - from.y);
    while (length > 0) {
      const step = Math.min(left, length);
      const t = step / length;
      const next = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (drawing) g.moveTo(from.x, from.y).lineTo(next.x, next.y);
      from = next;
      length -= step;
      left -= step;
      if (left <= 0) {
        drawing = !drawing;
        left = drawing ? dash : gap;
      }
    }
  }
}

export function traceEdgePath(g: Graphics, path: EdgePath): void {
  if (path.kind === "bezier") {
    g.moveTo(path.start.x, path.start.y).bezierCurveTo(path.c1.x, path.c1.y, path.c2.x, path.c2.y, path.end.x, path.end.y);
    return;
  }
  const points = path.points;
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const radius = Math.min(ROUTE_CORNER_RADIUS, inLength / 2, outLength / 2);
    if (radius < 0.01) {
      g.lineTo(corner.x, corner.y);
      continue;
    }
    const before = {
      x: corner.x - ((corner.x - previous.x) / inLength) * radius,
      y: corner.y - ((corner.y - previous.y) / inLength) * radius,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outLength) * radius,
      y: corner.y + ((next.y - corner.y) / outLength) * radius,
    };
    g.lineTo(before.x, before.y).quadraticCurveTo(corner.x, corner.y, after.x, after.y);
  }
  const last = points[points.length - 1];
  g.lineTo(last.x, last.y);
}
