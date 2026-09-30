import { GraphModel } from "./graph";
import { createNode, createPlaceholder, NodeModel, restorePorts } from "./node";
import type { NodeGraphRegistry } from "./registry";
import {
  isValidId,
  NodeSchemaMismatchError,
  type PortCapacity,
  type PortDirection,
  type PortSnapshot,
  RegistryError,
  type UnresolvedConnection,
} from "./types";

export const GRAPH_FORMAT = "node-graph";
export const GRAPH_FORMAT_VERSION = 1;

export class GraphSerializationError extends Error {}

export interface GraphLoadResult {
  graph: GraphModel;
  warnings: string[];
}

interface PointDto {
  x: number;
  y: number;
}

interface PortDto {
  id: string;
  key: string;
  direction: PortDirection;
  capacity: PortCapacity;
  typeId: string;
  displayName: string;
  isDynamic: boolean;
}

interface NodeDto {
  id: string;
  typeId: string;
  position: PointDto;
  ports: PortDto[];
  state: Record<string, unknown>;
}

interface ConnectionDto {
  id: string | null;
  outputNodeId: string | null;
  outputPortId: string | null;
  inputNodeId: string | null;
  inputPortId: string | null;
  reason: string | null;
}

interface GraphDocumentDto {
  format: string;
  version: number;
  graphId: string;
  viewport: { position: PointDto; zoom: number };
  nodes: NodeDto[];
  connections: ConnectionDto[];
  unresolvedConnections: ConnectionDto[];
}

/** Reads and writes the same JSON document format as the Unity implementation. */
export class GraphJsonSerializer {
  constructor(private readonly registry: NodeGraphRegistry) {}

  serialize(graph: GraphModel): string {
    const document: GraphDocumentDto = {
      format: GRAPH_FORMAT,
      version: GRAPH_FORMAT_VERSION,
      graphId: graph.id,
      viewport: {
        position: { x: graph.viewport.x, y: graph.viewport.y },
        zoom: graph.viewport.zoom,
      },
      nodes: [...graph.nodes].map((node) => ({
        id: node.id,
        typeId: node.typeId,
        position: { x: node.position.x, y: node.position.y },
        ports: node.ports.map((port) => ({
          id: port.id,
          key: port.key,
          direction: port.direction,
          capacity: port.capacity,
          typeId: port.typeId,
          displayName: port.displayName,
          isDynamic: port.isDynamic,
        })),
        state: captureState(node),
      })),
      connections: [...graph.connections].map((connection) => ({
        id: connection.id,
        outputNodeId: connection.outputNodeId,
        outputPortId: connection.outputPortId,
        inputNodeId: connection.inputNodeId,
        inputPortId: connection.inputPortId,
        reason: null,
      })),
      unresolvedConnections: graph.unresolvedConnections.map((connection) => ({ ...connection })),
    };
    return JSON.stringify(document, null, 2);
  }

  deserialize(json: string): GraphLoadResult {
    if (!json.trim()) {
      throw new GraphSerializationError("The graph JSON is empty.");
    }

    let document: Partial<GraphDocumentDto>;
    try {
      document = JSON.parse(json);
    } catch (error) {
      throw new GraphSerializationError(`The graph JSON could not be parsed: ${(error as Error).message}`);
    }

    if (!isObject(document)) {
      throw new GraphSerializationError("The graph JSON produced an empty document.");
    }
    if (document.format !== GRAPH_FORMAT) {
      throw new GraphSerializationError(`Unsupported graph format '${document.format}'.`);
    }
    if (document.version !== GRAPH_FORMAT_VERSION) {
      throw new GraphSerializationError(`Unsupported graph format version '${document.version}'.`);
    }

    const graph = new GraphModel(this.registry, requireId(document.graphId, "graphId"));
    const warnings: string[] = [];
    const nodeIds = new Set<string>();

    graph.batch(() => {
      for (const nodeDto of asArray<NodeDto>(document.nodes, "nodes")) {
        if (!isObject(nodeDto)) {
          throw new GraphSerializationError("The nodes array contains null.");
        }
        const nodeId = requireId(nodeDto.id, "node.id");
        if (nodeIds.has(nodeId)) {
          throw new GraphSerializationError(`Duplicate node id '${nodeId}'.`);
        }
        nodeIds.add(nodeId);

        const typeId = String(nodeDto.typeId ?? "");
        const snapshots = parsePortSnapshots(nodeDto.ports);
        const rawState = isObject(nodeDto.state) ? (nodeDto.state as Record<string, unknown>) : {};
        let node: NodeModel;

        const definition = this.registry.nodes.get(typeId);
        if (!definition) {
          node = createPlaceholder(nodeId, typeId, rawState, snapshots);
          warnings.push(`Unknown node type '${typeId}' was loaded as a placeholder.`);
        } else {
          try {
            node = createNode(this.registry.nodes, typeId, nodeId);
            restorePorts(node, snapshots, this.registry.dataTypes);
            node.state = definition.restoreState ? definition.restoreState(rawState) : { ...rawState };
          } catch (error) {
            if (!(error instanceof NodeSchemaMismatchError || error instanceof RegistryError || error instanceof TypeError)) {
              throw error;
            }
            node = createPlaceholder(nodeId, typeId, rawState, snapshots);
            warnings.push(`Node '${typeId}' could not be restored and was loaded as a placeholder: ${error.message}`);
          }
        }

        graph.addNode(node, toPoint(nodeDto.position));
      }

      const connectionIds = new Set<string>();
      for (const connectionDto of asArray<ConnectionDto>(document.connections, "connections")) {
        const dto = normalizeConnection(connectionDto);
        if (!dto.id) {
          graph.addUnresolvedConnection({ ...dto, reason: "Invalid or duplicate connection id." });
          warnings.push("A connection with an invalid id was preserved as unresolved.");
          continue;
        }
        if (connectionIds.has(dto.id)) {
          throw new GraphSerializationError(`Duplicate connection id '${dto.id}'.`);
        }
        connectionIds.add(dto.id);

        const endpointError = validateEndpoints(graph, dto);
        if (endpointError) {
          graph.addUnresolvedConnection({ ...dto, reason: endpointError });
          warnings.push(`A connection was preserved as unresolved: ${endpointError}`);
          continue;
        }

        const result = graph.connect(dto.outputPortId!, dto.inputPortId!, dto.id);
        if (!result.success) {
          graph.addUnresolvedConnection({ ...dto, reason: result.message });
          warnings.push(`A connection was preserved as unresolved: ${result.message}`);
        }
      }

      for (const unresolvedDto of asArray<ConnectionDto>(document.unresolvedConnections, "unresolvedConnections")) {
        const dto = normalizeConnection(unresolvedDto);
        if (dto.id) {
          if (connectionIds.has(dto.id)) {
            throw new GraphSerializationError(`Duplicate connection id '${dto.id}'.`);
          }
          connectionIds.add(dto.id);
        }
        graph.addUnresolvedConnection({
          ...dto,
          reason: dto.reason || "Unresolved connection from source document.",
        });
      }

      const viewport = isObject(document.viewport) ? document.viewport : null;
      const viewportPosition = toPoint(viewport?.position);
      graph.setViewport({
        x: viewportPosition.x,
        y: viewportPosition.y,
        zoom: typeof viewport?.zoom === "number" ? viewport.zoom : 1,
      });
    });

    return { graph, warnings };
  }
}

function captureState(node: NodeModel): Record<string, unknown> {
  if (node.isPlaceholder) {
    return node.rawState ?? {};
  }
  const capture = node.definition?.captureState;
  if (capture) {
    return capture(node.state);
  }
  return isObject(node.state) ? { ...(node.state as Record<string, unknown>) } : {};
}

function parsePortSnapshots(value: unknown): PortSnapshot[] {
  return asArray<PortDto>(value, "ports").map((port) => {
    if (!isObject(port)) {
      throw new GraphSerializationError("The ports array contains null.");
    }
    const direction = parseEnum(port.direction, ["Input", "Output"] as const);
    const capacity = parseEnum(port.capacity, ["Single", "Multiple"] as const);
    if (!direction || !capacity) {
      throw new GraphSerializationError(`Port '${port.key}' has invalid direction or capacity.`);
    }
    const key = String(port.key ?? "");
    return {
      id: requireId(port.id, "port.id"),
      key,
      direction,
      capacity,
      typeId: String(port.typeId ?? ""),
      displayName: typeof port.displayName === "string" && port.displayName.trim() ? port.displayName : key,
      isDynamic: port.isDynamic === true,
    };
  });
}

function validateEndpoints(graph: GraphModel, dto: UnresolvedConnection): string | null {
  const outputNode = dto.outputNodeId ? graph.getNode(dto.outputNodeId) : undefined;
  if (!outputNode) {
    return "Output node endpoint is missing.";
  }
  const output = dto.outputPortId ? graph.getPort(dto.outputPortId) : undefined;
  if (!output || output.nodeId !== outputNode.id) {
    return "Output endpoint is missing.";
  }
  const inputNode = dto.inputNodeId ? graph.getNode(dto.inputNodeId) : undefined;
  if (!inputNode) {
    return "Input node endpoint is missing.";
  }
  const input = dto.inputPortId ? graph.getPort(dto.inputPortId) : undefined;
  if (!input || input.nodeId !== inputNode.id) {
    return "Input endpoint is missing.";
  }
  return null;
}

function normalizeConnection(value: unknown): UnresolvedConnection {
  const dto = isObject(value) ? (value as Partial<ConnectionDto>) : {};
  const id = (field: unknown) => (isValidId(field) ? field : null);
  return {
    id: id(dto.id),
    outputNodeId: id(dto.outputNodeId),
    outputPortId: id(dto.outputPortId),
    inputNodeId: id(dto.inputNodeId),
    inputPortId: id(dto.inputPortId),
    reason: typeof dto.reason === "string" ? dto.reason : "",
  };
}

function parseEnum<T extends string>(value: unknown, options: readonly T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }
  return options.find((option) => option.toLowerCase() === value.toLowerCase()) ?? null;
}

function requireId(value: unknown, field: string): string {
  if (!isValidId(value)) {
    throw new GraphSerializationError(`Field '${field}' contains an invalid GUID.`);
  }
  return value;
}

function toPoint(value: unknown): { x: number; y: number } {
  const point = isObject(value) ? (value as Partial<PointDto>) : {};
  return {
    x: typeof point.x === "number" && Number.isFinite(point.x) ? point.x : 0,
    y: typeof point.y === "number" && Number.isFinite(point.y) ? point.y : 0,
  };
}

function asArray<T>(value: unknown, field: string): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new GraphSerializationError(`Field '${field}' must be an array.`);
  }
  return value as T[];
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
