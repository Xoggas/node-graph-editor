export type PortDirection = "Input" | "Output";
export type PortCapacity = "Single" | "Multiple";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Port {
  /** Unique in the graph: `<node id>/<key>`. */
  id: string;
  /** Stable key inside the node, derived from the schema (see `derivePorts`). */
  key: string;
  direction: PortDirection;
  capacity: PortCapacity;
  typeId: string;
  displayName: string;
  nodeId: string;
}

export interface Connection {
  id: string;
  outputPortId: string;
  inputPortId: string;
  outputNodeId: string;
  inputNodeId: string;
}

export interface PortRef {
  node: string;
  port: string;
}

/** A connection from the document that could not be restored; kept so saving does not lose it. */
export interface UnresolvedConnection {
  id: string | null;
  from: PortRef | null;
  to: PortRef | null;
  reason: string;
}

export type ConnectionFailureReason =
  | "MissingEndpoint"
  | "DifferentGraphs"
  | "WrongDirection"
  | "UnknownDataType"
  | "IncompatibleTypes"
  | "InputCapacityReached"
  | "OutputCapacityReached"
  | "DuplicateConnection";

export type ConnectionResult =
  | { success: true; connection: Connection }
  | { success: false; reason: ConnectionFailureReason; message: string };

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
}

export class RegistryError extends Error {}

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId(): string {
  return crypto.randomUUID();
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && GUID_PATTERN.test(value) && value !== EMPTY_GUID;
}
