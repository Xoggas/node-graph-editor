import type { Vec2 } from "../graph/types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type EdgePath =
  | { kind: "bezier"; start: Vec2; c1: Vec2; c2: Vec2; end: Vec2 }
  /** Orthogonal route around the nodes, used when the input sits left of the output. */
  | { kind: "route"; points: Vec2[] };

const ROUTE_MARGIN = 16;
export const ROUTE_CORNER_RADIUS = 12;

export function rectsIntersect(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function rectToBounds(rect: Rect): Bounds {
  return { minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height };
}

export function computeEdgePath(start: Vec2, end: Vec2, source?: Rect, target?: Rect): EdgePath {
  if (source && target && end.x < start.x) {
    const routeY = findRouteY(start, end, source, target);
    const startX = source.x + source.width + ROUTE_MARGIN;
    const endX = target.x - ROUTE_MARGIN;
    return {
      kind: "route",
      points: [start, { x: startX, y: start.y }, { x: startX, y: routeY }, { x: endX, y: routeY }, { x: endX, y: end.y }, end],
    };
  }
  const tangent = Math.max(36, Math.abs(end.x - start.x) * 0.45);
  return {
    kind: "bezier",
    start,
    c1: { x: start.x + tangent, y: start.y },
    c2: { x: end.x - tangent, y: end.y },
    end,
  };
}

export function translatePath(path: EdgePath, dx: number, dy: number): EdgePath {
  const shift = (point: Vec2) => ({ x: point.x + dx, y: point.y + dy });
  return path.kind === "bezier"
    ? { kind: "bezier", start: shift(path.start), c1: shift(path.c1), c2: shift(path.c2), end: shift(path.end) }
    : { kind: "route", points: path.points.map(shift) };
}

/** Conservative bounds: a cubic bezier always lies inside the hull of its control points. */
export function edgeBounds(path: EdgePath, padding: number): Bounds {
  const points = path.kind === "bezier" ? [path.start, path.c1, path.c2, path.end] : path.points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

export function hitTestEdge(path: EdgePath, point: Vec2, tolerance: number): boolean {
  if (path.kind === "route") {
    for (let i = 1; i < path.points.length; i++) {
      if (distanceToSegment(point, path.points[i - 1], path.points[i]) <= tolerance) {
        return true;
      }
    }
    return false;
  }
  const samples = 32;
  let previous = path.start;
  for (let i = 1; i <= samples; i++) {
    const current = evaluateCubic(path, i / samples);
    if (distanceToSegment(point, previous, current) <= tolerance) {
      return true;
    }
    previous = current;
  }
  return false;
}

/** Points along the edge: the corners of a route, or samples of a bezier. */
export function samplePath(path: EdgePath, segments = 32): Vec2[] {
  return path.kind === "route" ? path.points : Array.from({ length: segments + 1 }, (_, i) => evaluateCubic(path, i / segments));
}

/** True when any part of the edge passes through `area`. */
export function edgeIntersectsBounds(path: EdgePath, area: Bounds): boolean {
  const points = path.kind === "route" ? path.points : Array.from({ length: 33 }, (_, i) => evaluateCubic(path, i / 32));
  for (let i = 1; i < points.length; i++) {
    if (segmentIntersectsBounds(points[i - 1], points[i], area)) {
      return true;
    }
  }
  return false;
}

/** Liang–Barsky clipping: whether the segment a→b has a part inside the box. */
function segmentIntersectsBounds(a: Vec2, b: Vec2, box: Bounds): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function evaluateCubic(path: Extract<EdgePath, { kind: "bezier" }>, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * path.start.x + b * path.c1.x + c * path.c2.x + d * path.end.x,
    y: a * path.start.y + b * path.c1.y + c * path.c2.y + d * path.end.y,
  };
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function findRouteY(start: Vec2, end: Vec2, source: Rect, target: Rect): number {
  const sourceCenter = source.y + source.height / 2;
  const targetCenter = target.y + target.height / 2;
  const sourceBelowTarget = sourceCenter > targetCenter;
  const gapStart = sourceBelowTarget ? target.y + target.height + ROUTE_MARGIN : source.y + source.height + ROUTE_MARGIN;
  const gapEnd = sourceBelowTarget ? source.y - ROUTE_MARGIN : target.y - ROUTE_MARGIN;
  if (gapStart <= gapEnd) {
    return (gapStart + gapEnd) / 2;
  }
  const routeBelow = Math.max(source.y + source.height, target.y + target.height) + ROUTE_MARGIN;
  const routeAbove = Math.min(source.y, target.y) - ROUTE_MARGIN;
  const belowDistance = Math.abs(routeBelow - start.y) + Math.abs(routeBelow - end.y);
  const aboveDistance = Math.abs(routeAbove - start.y) + Math.abs(routeAbove - end.y);
  return belowDistance <= aboveDistance ? routeBelow : routeAbove;
}
