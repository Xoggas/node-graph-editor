using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NodeGraph.Core;
using UnityEngine;

namespace NodeGraph.Serialization
{
    public sealed class GraphLoadResult
    {
        public GraphModel Graph { get; }
        public IReadOnlyList<string> Warnings { get; }

        public GraphLoadResult(GraphModel graph, IReadOnlyList<string> warnings)
        {
            Graph = graph;
            Warnings = warnings;
        }
    }

    public sealed class GraphSerializationException : Exception
    {
        public GraphSerializationException(string message) : base(message)
        {
        }

        public GraphSerializationException(string message, Exception innerException) : base(message, innerException)
        {
        }
    }

    public sealed class GraphJsonSerializer
    {
        public const string Format = "node-graph";
        public const int CurrentVersion = 1;

        private readonly NodeGraphRegistry _registry;
        private readonly JsonSerializerSettings _settings;

        public GraphJsonSerializer(NodeGraphRegistry registry)
        {
            _registry = registry ?? throw new ArgumentNullException(nameof(registry));
            _settings = new JsonSerializerSettings
            {
                Formatting = Formatting.Indented,
                TypeNameHandling = TypeNameHandling.None,
                Culture = CultureInfo.InvariantCulture,
                NullValueHandling = NullValueHandling.Include,
                MissingMemberHandling = MissingMemberHandling.Ignore,
                Converters = new List<JsonConverter>
                {
                    new GuidDJsonConverter()
                }
            };
        }

        public string Serialize(GraphModel graph)
        {
            if (graph == null)
            {
                throw new ArgumentNullException(nameof(graph));
            }

            var document = new GraphDocumentDto
            {
                Format = Format,
                Version = CurrentVersion,
                GraphId = graph.Id,
                Viewport = new ViewportDto
                {
                    Position = new PointDto
                    {
                        X = graph.Viewport.Position.x,
                        Y = graph.Viewport.Position.y
                    },
                    Zoom = graph.Viewport.Zoom
                }
            };

            foreach (var node in graph.Nodes)
            {
                var nodeDto = new NodeDto
                {
                    Id = node.Id,
                    TypeId = node.TypeId,
                    Position = new PointDto { X = node.Position.x, Y = node.Position.y },
                    State = SerializeState(node)
                };

                foreach (var port in node.Ports)
                {
                    nodeDto.Ports.Add(new PortDto
                    {
                        Id = port.Id,
                        Key = port.Key,
                        Direction = port.Direction.ToString(),
                        Capacity = port.Capacity.ToString(),
                        TypeId = port.TypeId,
                        DisplayName = port.DisplayName,
                        IsDynamic = port.IsDynamic
                    });
                }

                document.Nodes.Add(nodeDto);
            }

            foreach (var connection in graph.Connections)
            {
                document.Connections.Add(ToConnectionDto(connection.Id, connection.OutputNode.Id, connection.Output.Id, connection.InputNode.Id, connection.Input.Id, null));
            }

            foreach (var unresolved in graph.UnresolvedConnections)
            {
                document.UnresolvedConnections.Add(new UnresolvedConnectionDto
                {
                    Id = unresolved.Id,
                    OutputNodeId = unresolved.OutputNodeId,
                    OutputPortId = unresolved.OutputPortId,
                    InputNodeId = unresolved.InputNodeId,
                    InputPortId = unresolved.InputPortId,
                    Reason = unresolved.Reason
                });
            }

            return JsonConvert.SerializeObject(document, _settings);
        }

        public GraphLoadResult Deserialize(string json)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new GraphSerializationException("The graph JSON is empty.");
            }

            GraphDocumentDto document;
            try
            {
                document = JsonConvert.DeserializeObject<GraphDocumentDto>(json, _settings);
            }
            catch (Exception exception)
            {
                throw new GraphSerializationException("The graph JSON could not be parsed.", exception);
            }

            if (document == null)
            {
                throw new GraphSerializationException("The graph JSON produced an empty document.");
            }
            if (!string.Equals(document.Format, Format, StringComparison.Ordinal))
            {
                throw new GraphSerializationException($"Unsupported graph format '{document.Format}'.");
            }
            if (document.Version != CurrentVersion)
            {
                throw new GraphSerializationException($"Unsupported graph format version '{document.Version}'.");
            }

            var graphId = ParseGuid(document.GraphId, "graphId");
            var graph = new GraphModel(_registry, graphId);
            var warnings = new List<string>();
            var nodeIds = new HashSet<Guid>();

            foreach (var nodeDto in document.Nodes ?? new List<NodeDto>())
            {
                if (nodeDto == null)
                {
                    throw new GraphSerializationException("The nodes array contains null.");
                }

                var nodeId = ParseGuid(nodeDto.Id, "node.id");
                if (!nodeIds.Add(nodeId))
                {
                    throw new GraphSerializationException($"Duplicate node id '{nodeId}'.");
                }

                var snapshots = ParsePortSnapshots(nodeDto.Ports);
                NodeModel node;

                if (!_registry.Nodes.TryGet(nodeDto.TypeId, out _))
                {
                    node = CreatePlaceholder(nodeId, nodeDto, snapshots);
                    warnings.Add($"Unknown node type '{nodeDto.TypeId}' was loaded as a placeholder.");
                }
                else
                {
                    try
                    {
                        node = _registry.Nodes.CreateNode(nodeDto.TypeId, nodeId);
                        node.RestorePorts(snapshots);
                        RestoreState(node, nodeDto.State);
                    }
                    catch (Exception exception) when (exception is NodeSchemaMismatchException || exception is RegistryException || exception is JsonException || exception is InvalidOperationException)
                    {
                        node = CreatePlaceholder(nodeId, nodeDto, snapshots);
                        warnings.Add($"Node '{nodeDto.TypeId}' could not be restored and was loaded as a placeholder: {exception.Message}");
                    }
                }

                var position = nodeDto.Position == null
                    ? Vector2.zero
                    : new Vector2(nodeDto.Position.X, nodeDto.Position.Y);
                graph.AddNode(node, position);
            }

            var connectionIds = new HashSet<Guid>();
            foreach (var connectionDto in document.Connections ?? new List<ConnectionDto>())
            {
                var connectionId = connectionDto?.Id;
                if (!connectionId.HasValue || connectionId.Value == Guid.Empty)
                {
                    AddUnresolved(graph, connectionDto, "Invalid or duplicate connection id.");
                    warnings.Add("A connection with an invalid id was preserved as unresolved.");
                    continue;
                }
                if (!connectionIds.Add(connectionId.Value))
                {
                    throw new GraphSerializationException($"Duplicate connection id '{connectionId.Value}'.");
                }

                if (!TryResolveEndpoint(graph, connectionDto, out var output, out var input, out var endpointError))
                {
                    AddUnresolved(graph, connectionDto, endpointError);
                    warnings.Add($"A connection was preserved as unresolved: {endpointError}");
                    continue;
                }

                var result = graph.TryConnect(output, input, connectionId.Value);
                if (!result.Success)
                {
                    AddUnresolved(graph, connectionDto, result.Message);
                    warnings.Add($"A connection was preserved as unresolved: {result.Message}");
                }
            }

            foreach (var unresolved in document.UnresolvedConnections ?? new List<UnresolvedConnectionDto>())
            {
                var unresolvedId = unresolved?.Id;
                if (unresolvedId.HasValue && unresolvedId.Value != Guid.Empty && !connectionIds.Add(unresolvedId.Value))
                {
                    throw new GraphSerializationException($"Duplicate connection id '{unresolvedId.Value}'.");
                }
                AddUnresolved(graph, unresolved, unresolved?.Reason ?? "Unresolved connection from source document.");
            }

            var viewport = document.Viewport == null
                ? new GraphViewport(Vector2.zero, 1f)
                : new GraphViewport(
                    document.Viewport.Position == null
                        ? Vector2.zero
                        : new Vector2(document.Viewport.Position.X, document.Viewport.Position.Y),
                    document.Viewport.Zoom);
            graph.SetViewport(viewport);
            return new GraphLoadResult(graph, warnings);
        }

        private JObject SerializeState(NodeModel node)
        {
            if (node is IPlaceholderNode placeholder)
            {
                try
                {
                    return JObject.Parse(string.IsNullOrWhiteSpace(placeholder.RawStateJson) ? "{}" : placeholder.RawStateJson);
                }
                catch (JsonException)
                {
                    return new JObject { ["raw"] = placeholder.RawStateJson ?? string.Empty };
                }
            }

            var state = node.CaptureStateObject();
            return state == null ? new JObject() : JObject.FromObject(state, JsonSerializer.Create(_settings));
        }

        private void RestoreState(NodeModel node, JObject state)
        {
            if (node.StateType == null || state == null)
            {
                return;
            }

            var serializer = JsonSerializer.Create(_settings);
            using (var reader = state.CreateReader())
            {
                var value = serializer.Deserialize(reader, node.StateType);
                node.RestoreStateObject(value);
            }
        }

        private PlaceholderNodeModel CreatePlaceholder(Guid id, NodeDto nodeDto, IReadOnlyList<PortSnapshot> snapshots)
        {
            var rawState = (nodeDto.State ?? new JObject()).ToString(Formatting.None);
            var placeholder = new PlaceholderNodeModel(id, nodeDto.TypeId, rawState);
            placeholder.InitializePlaceholder(_registry.DataTypes, snapshots);
            return placeholder;
        }

        private IReadOnlyList<PortSnapshot> ParsePortSnapshots(IEnumerable<PortDto> ports)
        {
            var result = new List<PortSnapshot>();
            foreach (var port in ports ?? Enumerable.Empty<PortDto>())
            {
                if (port == null)
                {
                    throw new GraphSerializationException("The ports array contains null.");
                }
                if (!Enum.TryParse(port.Direction, true, out PortDirection direction) ||
                    !Enum.TryParse(port.Capacity, true, out PortCapacity capacity))
                {
                    throw new GraphSerializationException($"Port '{port.Key}' has invalid direction or capacity.");
                }

                result.Add(new PortSnapshot(
                    ParseGuid(port.Id, "port.id"),
                    port.Key,
                    direction,
                    capacity,
                    port.TypeId,
                    port.DisplayName,
                    port.IsDynamic));
            }
            return result;
        }

        private static ConnectionDto ToConnectionDto(Guid id, Guid outputNodeId, Guid outputPortId, Guid inputNodeId, Guid inputPortId, string reason)
        {
            return new ConnectionDto
            {
                Id = id,
                OutputNodeId = outputNodeId,
                OutputPortId = outputPortId,
                InputNodeId = inputNodeId,
                InputPortId = inputPortId,
                Reason = reason
            };
        }

        private static bool TryResolveEndpoint(GraphModel graph, ConnectionDto dto, out Port output, out Port input, out string error)
        {
            output = null;
            input = null;
            if (dto == null || !dto.OutputNodeId.HasValue || dto.OutputNodeId.Value == Guid.Empty ||
                !graph.TryGetNode(dto.OutputNodeId.Value, out var outputNode))
            {
                error = "Output node endpoint is missing.";
                return false;
            }
            if (!dto.OutputPortId.HasValue || dto.OutputPortId.Value == Guid.Empty ||
                !graph.TryGetPort(dto.OutputPortId.Value, out output) || !ReferenceEquals(output.Owner, outputNode))
            {
                error = "Output endpoint is missing.";
                return false;
            }
            if (!dto.InputNodeId.HasValue || dto.InputNodeId.Value == Guid.Empty ||
                !graph.TryGetNode(dto.InputNodeId.Value, out var inputNode))
            {
                error = "Input node endpoint is missing.";
                return false;
            }
            if (!dto.InputPortId.HasValue || dto.InputPortId.Value == Guid.Empty ||
                !graph.TryGetPort(dto.InputPortId.Value, out input) || !ReferenceEquals(input.Owner, inputNode))
            {
                error = "Input endpoint is missing.";
                return false;
            }
            error = null;
            return true;
        }

        private static void AddUnresolved(GraphModel graph, ConnectionDto dto, string reason)
        {
            graph.AddUnresolvedConnection(new UnresolvedConnection(
                dto?.Id,
                dto?.OutputNodeId,
                dto?.OutputPortId,
                dto?.InputNodeId,
                dto?.InputPortId,
                reason));
        }

        private static void AddUnresolved(GraphModel graph, UnresolvedConnectionDto dto, string reason)
        {
            graph.AddUnresolvedConnection(new UnresolvedConnection(
                dto?.Id,
                dto?.OutputNodeId,
                dto?.OutputPortId,
                dto?.InputNodeId,
                dto?.InputPortId,
                reason));
        }

        private static Guid ParseGuid(Guid value, string field)
        {
            if (value == Guid.Empty)
            {
                throw new GraphSerializationException($"Field '{field}' contains an invalid GUID.");
            }
            return value;
        }

        private sealed class GuidDJsonConverter : JsonConverter
        {
            public override bool CanConvert(Type objectType)
            {
                return objectType == typeof(Guid) || objectType == typeof(Guid?);
            }

            public override void WriteJson(JsonWriter writer, object value, JsonSerializer serializer)
            {
                if (value == null)
                {
                    writer.WriteNull();
                    return;
                }

                writer.WriteValue(((Guid)value).ToString("D"));
            }

            public override object ReadJson(JsonReader reader, Type objectType, object existingValue, JsonSerializer serializer)
            {
                if (reader.TokenType == JsonToken.Null && objectType == typeof(Guid?))
                {
                    return null;
                }

                if (reader.TokenType != JsonToken.String ||
                    !Guid.TryParse(reader.Value as string, out var result) ||
                    result == Guid.Empty)
                {
                    throw new JsonSerializationException("A graph GUID must be a non-empty string in D format.");
                }

                return result;
            }
        }
    }
}
