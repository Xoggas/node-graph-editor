export type PortDirection = "Input" | "Output";
export type PortCapacity = "Single" | "Multiple";

export interface Vec2 {
  x: number;
  y: number;
}

export interface Port {
  id: string;
  key: string;
  direction: PortDirection;
  capacity: PortCapacity;
  typeId: string;
  displayName: string;
  isDynamic: boolean;
  nodeId: string;
}

export interface PortSnapshot {
  id: string;
  key: string;
  direction: PortDirection;
  capacity: PortCapacity;
  typeId: string;
  displayName: string;
  isDynamic: boolean;
}

export interface PortDefinition {
  key: string;
  direction: PortDirection;
  typeId: string;
  capacity?: PortCapacity;
  displayName?: string;
}

export interface Connection {
  id: string;
  outputPortId: string;
  inputPortId: string;
  outputNodeId: string;
  inputNodeId: string;
}

export interface UnresolvedConnection {
  id: string | null;
  outputNodeId: string | null;
  outputPortId: string | null;
  inputNodeId: string | null;
  inputPortId: string | null;
  reason: string;
}

export type ConnectionFailureReason =
  | "MissingEndpoint"
  | "DifferentGraphs"
  | "WrongDirection"
  | "UnknownDataType"
  | "IncompatibleTypes"
  | "InputCapacityReached"
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
export class NodeSchemaMismatchError extends Error {}

export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newId(): string {
  return crypto.randomUUID();
}

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && GUID_PATTERN.test(value) && value !== EMPTY_GUID;
}
