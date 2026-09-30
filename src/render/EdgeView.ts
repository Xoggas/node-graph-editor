import { Graphics } from "pixi.js";
import type { Connection } from "../graph/types";
import { type Bounds, type EdgePath, edgeBounds, ROUTE_CORNER_RADIUS, translatePath } from "./geometry";
import { theme } from "./theme";

const EDGE_WIDTH = 2.25;
const SELECTED_EDGE_WIDTH = 4;

export class EdgeView {
  readonly graphics = new Graphics();
  path: EdgePath | null = null;
  bounds: Bounds = { minX: 0, minY: 0, maxX: -1, maxY: -1 };
  selected = false;

  constructor(
    readonly connection: Connection,
    private readonly color: number,
  ) {}

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
    const width = (this.selected ? SELECTED_EDGE_WIDTH : EDGE_WIDTH) * scale;
    // Geometry is drawn in world coordinates; undo any pending translation offset first.
    const { x: offsetX, y: offsetY } = this.graphics.position;
    const path = offsetX === 0 && offsetY === 0 ? this.path : translatePath(this.path, -offsetX, -offsetY);
    traceEdgePath(g, path);
    g.stroke({ width, color: this.selected ? theme.connectionSelected : this.color, cap: "round", join: "round" });
    this.bounds = edgeBounds(this.path, width);
  }

  destroy(): void {
    this.graphics.destroy();
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
