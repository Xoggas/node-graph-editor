import { GraphModel } from "./graph";
import { t } from "../i18n";
import { createNode, createPlaceholder, type NodeModel, portId } from "./node";
import type { SchemaRegistry } from "./registry";
import { isRecord, normalizeData } from "./schema";
import { isValidId, NOTE_COLORS, NOTE_DEFAULT_SIZE, NOTE_MIN_SIZE, type PortDirection, type PortRef, type UnresolvedConnection } from "./types";

export const GRAPH_FORMAT = "node-graph";
export const GRAPH_FORMAT_VERSION = 2;

export class GraphSerializationError extends Error {}

export interface GraphLoadResult {
  graph: GraphModel;
  warnings: string[];
  /** The warning about a graph made with another pack (also in `warnings`), which a pack reload drops. */
  packWarning?: string;
}

interface NodeDto {
  id: string;
  schema: string;
  schemaVersion: number | null;
  name: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface AliasDto {
  id: string;
  node: string;
  position: { x: number; y: number };
}

interface NoteDto {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  text: string;
  color: string;
}

interface ConnectionDto {
  id: string | null;
  from: PortRef | null;
  to: PortRef | null;
  reason?: string;
}

interface GraphDocumentDto {
  format: string;
  version: number;
  graphId: string;
  pack: { id: string; version: number } | null;
  viewport: { x: number; y: number; zoom: number };
  nodes: NodeDto[];
  /** Linked copies of nodes (editor only). */
  aliases?: AliasDto[];
  /** Sticky notes (editor only). */
  notes?: NoteDto[];
  connections: ConnectionDto[];
  unresolvedConnections: ConnectionDto[];
}

/**
 * Graph documents store, per node, the schema id and version, the node name and its data;
 * connections reference ports by node id and schema port key.
 */
export class GraphJsonSerializer {
  constructor(private readonly registry: SchemaRegistry) {}

  serialize(graph: GraphModel): string {
    const pack = this.registry.pack;
    const document: GraphDocumentDto = {
      format: GRAPH_FORMAT,
      version: GRAPH_FORMAT_VERSION,
      graphId: graph.id,
      pack: pack ? { id: pack.id, version: pack.version } : null,
      viewport: { ...graph.viewport },
      nodes: [...graph.nodes].map((node) => ({
        id: node.id,
        schema: node.schemaId,
        schemaVersion: node.schema?.version ?? node.loadedSchemaVersion ?? null,
        name: node.name,
        position: { x: node.position.x, y: node.position.y },
        data: node.data,
      })),
      aliases: [...graph.aliases].map((alias) => ({
        id: alias.id,
        node: alias.nodeId,
        position: { x: alias.position.x, y: alias.position.y },
      })),
      notes: [...graph.notes].map((note) => ({
        id: note.id,
        position: { x: note.position.x, y: note.position.y },
        size: { width: note.size.width, height: note.size.height },
        text: note.text,
        color: note.color,
      })),
      connections: [...graph.connections].map((connection) => ({
        id: connection.id,
        from: portRef(connection.outputNodeId, graph.getPort(connection.outputPortId)!.key, connection.outputViewId),
        to: portRef(connection.inputNodeId, graph.getPort(connection.inputPortId)!.key, connection.inputViewId),
      })),
      unresolvedConnections: graph.unresolvedConnections.map((connection) => ({ ...connection })),
    };
    return JSON.stringify(document, null, 2);
  }

  deserialize(json: string): GraphLoadResult {
    if (!json.trim()) {
      throw new GraphSerializationError(t("The graph JSON is empty."));
    }
    let document: Partial<GraphDocumentDto>;
    try {
      document = JSON.parse(json);
    } catch (error) {
      throw new GraphSerializationError(t("The graph JSON could not be parsed: {error}", { error: (error as Error).message }));
    }
    if (!isRecord(document)) {
      throw new GraphSerializationError(t("The graph JSON produced an empty document."));
    }
    if (document.format !== GRAPH_FORMAT) {
      throw new GraphSerializationError(t("Unsupported graph format '{format}'.", { format: String(document.format) }));
    }
    if (document.version !== GRAPH_FORMAT_VERSION) {
      throw new GraphSerializationError(
        t("Unsupported graph format version '{version}' (expected {expected}).", { version: String(document.version), expected: GRAPH_FORMAT_VERSION }),
      );
    }

    const warnings: string[] = [];
    const pack = this.registry.pack;
    const documentPack = isRecord(document.pack) ? document.pack : null;
    let packWarning: string | undefined;
    if (documentPack && (!pack || pack.id !== documentPack.id)) {
      packWarning = pack
        ? t("The graph was made with schema pack '{made}', but '{loaded}' is loaded.", { made: String(documentPack.id), loaded: pack.id })
        : t("The graph was made with schema pack '{made}', but no pack is loaded.", { made: String(documentPack.id) });
      warnings.push(packWarning);
    }

    const graph = new GraphModel(this.registry, requireId(document.graphId, "graphId"));
    const nodeDtos = asArray<NodeDto>(document.nodes, "nodes");
    const connectionDtos = asArray<unknown>(document.connections, "connections").map(normalizeConnection);

    graph.batch(() => {
      const nodeIds = new Set<string>();
      for (const nodeDto of nodeDtos) {
        if (!isRecord(nodeDto)) {
          throw new GraphSerializationError(t("The nodes array contains a non-object entry."));
        }
        const nodeId = requireId(nodeDto.id, "node.id");
        if (nodeIds.has(nodeId)) {
          throw new GraphSerializationError(t("Duplicate node id '{id}'.", { id: nodeId }));
        }
        nodeIds.add(nodeId);
        const schemaId = typeof nodeDto.schema === "string" ? nodeDto.schema : "";
        const name = typeof nodeDto.name === "string" ? nodeDto.name : "";
        const rawData = isRecord(nodeDto.data) ? nodeDto.data : {};
        const label = name || schemaId;
        let node: NodeModel;

        const schema = this.registry.getSchema(schemaId);
        if (schema) {
          const data = normalizeData(schema, rawData, (message) => warnings.push(t("Node '{node}': {message}", { node: label, message })));
          node = createNode(this.registry, schemaId, nodeId, data);
          node.name = name;
          const version = typeof nodeDto.schemaVersion === "number" ? nodeDto.schemaVersion : null;
          if (version !== null && version !== schema.version) {
            warnings.push(
              t("Node '{node}' was saved with version {version} of '{type}', the pack has version {current}.", {
                node: label,
                version,
                type: schemaId,
                current: schema.version,
              }),
            );
          }
        } else {
          node = createPlaceholder(nodeId, schemaId, rawData, name, placeholderPorts(nodeId, connectionDtos));
          warnings.push(t("Unknown node schema '{type}' — node '{node}' was loaded as a placeholder.", { type: schemaId, node: label }));
        }
        node.loadedSchemaVersion = typeof nodeDto.schemaVersion === "number" ? nodeDto.schemaVersion : null;
        graph.addNode(node, toPoint(nodeDto.position));
      }

      for (const aliasDto of asArray<unknown>(document.aliases, "aliases")) {
        const dto: Record<string, unknown> = isRecord(aliasDto) ? aliasDto : {};
        if (!isValidId(dto.id) || !isValidId(dto.node) || !graph.getNode(dto.node)) {
          warnings.push(t("A linked copy of a missing node was dropped."));
          continue;
        }
        if (graph.getAlias(dto.id) || graph.getNode(dto.id)) {
          throw new GraphSerializationError(t("Duplicate id '{id}'.", { id: dto.id }));
        }
        graph.addAlias({ id: dto.id, nodeId: dto.node, position: { x: 0, y: 0 } }, toPoint(dto.position));
      }

      for (const noteDto of asArray<unknown>(document.notes, "notes")) {
        const dto: Record<string, unknown> = isRecord(noteDto) ? noteDto : {};
        if (!isValidId(dto.id)) {
          warnings.push(t("A note with an invalid id was dropped."));
          continue;
        }
        if (graph.getNote(dto.id) || graph.getAlias(dto.id) || graph.getNode(dto.id)) {
          throw new GraphSerializationError(t("Duplicate id '{id}'.", { id: dto.id }));
        }
        const size: Record<string, unknown> = isRecord(dto.size) ? dto.size : {};
        const dimension = (value: unknown, fallback: number, min: number) =>
          typeof value === "number" && Number.isFinite(value) ? Math.max(min, value) : fallback;
        graph.addNote({
          id: dto.id,
          position: toPoint(dto.position),
          size: {
            width: dimension(size.width, NOTE_DEFAULT_SIZE.width, NOTE_MIN_SIZE.width),
            height: dimension(size.height, NOTE_DEFAULT_SIZE.height, NOTE_MIN_SIZE.height),
          },
          text: typeof dto.text === "string" ? dto.text : "",
          color: typeof dto.color === "string" ? dto.color : NOTE_COLORS[0],
        });
      }

      const connectionIds = new Set<string>();
      for (const dto of connectionDtos) {
        if (!dto.id) {
          graph.addUnresolvedConnection({ ...dto, reason: "Invalid connection id." });
          warnings.push(t("A connection with an invalid id was kept as unresolved."));
          continue;
        }
        if (connectionIds.has(dto.id)) {
          throw new GraphSerializationError(t("Duplicate connection id '{id}'.", { id: dto.id }));
        }
        connectionIds.add(dto.id);
        const problem = this.connectFromDto(graph, dto);
        if (problem) {
          graph.addUnresolvedConnection({ ...dto, reason: problem });
          warnings.push(t("A connection was kept as unresolved: {problem}", { problem }));
        }
      }

      for (const raw of asArray<unknown>(document.unresolvedConnections, "unresolvedConnections")) {
        const dto = normalizeConnection(raw);
        if (dto.id && connectionIds.has(dto.id)) {
          throw new GraphSerializationError(t("Duplicate connection id '{id}'.", { id: dto.id }));
        }
        if (dto.id) {
          connectionIds.add(dto.id);
        }
        graph.addUnresolvedConnection({ ...dto, reason: dto.reason || "Unresolved connection from the source document." });
      }

      const viewport: Record<string, unknown> = isRecord(document.viewport) ? document.viewport : {};
      graph.setViewport({
        x: finiteOr(viewport.x, 0),
        y: finiteOr(viewport.y, 0),
        zoom: finiteOr(viewport.zoom, 1),
      });
    });

    return { graph, warnings, packWarning };
  }

  private connectFromDto(graph: GraphModel, dto: UnresolvedConnection): string | null {
    if (!dto.from || !graph.getNode(dto.from.node)) {
      return t("Output node is missing.");
    }
    if (!dto.to || !graph.getNode(dto.to.node)) {
      return t("Input node is missing.");
    }
    const output = graph.getPort(portId(dto.from.node, dto.from.port));
    if (!output) {
      return t("Output port '{port}' does not exist.", { port: dto.from.port });
    }
    const input = graph.getPort(portId(dto.to.node, dto.to.port));
    if (!input) {
      return t("Input port '{port}' does not exist.", { port: dto.to.port });
    }
    const result = graph.connect(output.id, input.id, dto.id!, { output: dto.from.view, input: dto.to.view });
    return result.success ? null : result.message;
  }
}

/** Port keys a placeholder node needs so that its saved connections can be restored. */
function placeholderPorts(nodeId: string, connections: UnresolvedConnection[]): { key: string; direction: PortDirection }[] {
  const ports: { key: string; direction: PortDirection }[] = [];
  for (const connection of connections) {
    if (connection.from?.node === nodeId) ports.push({ key: connection.from.port, direction: "Output" });
    if (connection.to?.node === nodeId) ports.push({ key: connection.to.port, direction: "Input" });
  }
  return ports;
}

function normalizeConnection(value: unknown): UnresolvedConnection {
  const dto = isRecord(value) ? value : {};
  const ref = (raw: unknown): PortRef | null =>
    isRecord(raw) && isValidId(raw.node) && typeof raw.port === "string" && raw.port
      ? portRef(raw.node, raw.port, isValidId(raw.view) ? raw.view : raw.node)
      : null;
  return {
    id: isValidId(dto.id) ? dto.id : null,
    from: ref(dto.from),
    to: ref(dto.to),
    reason: typeof dto.reason === "string" ? dto.reason : "",
  };
}

/** `view` is written only for ends drawn at an alias. */
function portRef(node: string, port: string, view: string): PortRef {
  return view === node ? { node, port } : { node, port, view };
}

function requireId(value: unknown, field: string): string {
  if (!isValidId(value)) {
    throw new GraphSerializationError(t("Field '{field}' contains an invalid GUID.", { field }));
  }
  return value;
}

function toPoint(value: unknown): { x: number; y: number } {
  const point: Record<string, unknown> = isRecord(value) ? value : {};
  return { x: finiteOr(point.x, 0), y: finiteOr(point.y, 0) };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asArray<T>(value: unknown, field: string): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new GraphSerializationError(t("Field '{field}' must be an array.", { field }));
  }
  return value as T[];
}
