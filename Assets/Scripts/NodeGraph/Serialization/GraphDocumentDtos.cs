using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace NodeGraph.Serialization
{
    internal sealed class GraphDocumentDto
    {
        [JsonProperty("format")]
        public string Format { get; set; }

        [JsonProperty("version")]
        public int Version { get; set; }

        [JsonProperty("graphId")]
        public System.Guid GraphId { get; set; }

        [JsonProperty("viewport")]
        public ViewportDto Viewport { get; set; }

        [JsonProperty("nodes")]
        public List<NodeDto> Nodes { get; set; } = new List<NodeDto>();

        [JsonProperty("connections")]
        public List<ConnectionDto> Connections { get; set; } = new List<ConnectionDto>();

        [JsonProperty("unresolvedConnections")]
        public List<UnresolvedConnectionDto> UnresolvedConnections { get; set; } = new List<UnresolvedConnectionDto>();
    }

    internal sealed class ViewportDto
    {
        [JsonProperty("position")]
        public PointDto Position { get; set; }

        [JsonProperty("zoom")]
        public float Zoom { get; set; }
    }

    internal sealed class PointDto
    {
        [JsonProperty("x")]
        public float X { get; set; }

        [JsonProperty("y")]
        public float Y { get; set; }
    }

    internal sealed class NodeDto
    {
        [JsonProperty("id")]
        public System.Guid Id { get; set; }

        [JsonProperty("typeId")]
        public string TypeId { get; set; }

        [JsonProperty("position")]
        public PointDto Position { get; set; }

        [JsonProperty("ports")]
        public List<PortDto> Ports { get; set; } = new List<PortDto>();

        [JsonProperty("state")]
        public JObject State { get; set; } = new JObject();
    }

    internal sealed class PortDto
    {
        [JsonProperty("id")]
        public System.Guid Id { get; set; }

        [JsonProperty("key")]
        public string Key { get; set; }

        [JsonProperty("direction")]
        public string Direction { get; set; }

        [JsonProperty("capacity")]
        public string Capacity { get; set; }

        [JsonProperty("typeId")]
        public string TypeId { get; set; }

        [JsonProperty("displayName")]
        public string DisplayName { get; set; }

        [JsonProperty("isDynamic")]
        public bool IsDynamic { get; set; }
    }

    internal sealed class ConnectionDto
    {
        [JsonProperty("id")]
        public System.Guid? Id { get; set; }

        [JsonProperty("outputNodeId")]
        public System.Guid? OutputNodeId { get; set; }

        [JsonProperty("outputPortId")]
        public System.Guid? OutputPortId { get; set; }

        [JsonProperty("inputNodeId")]
        public System.Guid? InputNodeId { get; set; }

        [JsonProperty("inputPortId")]
        public System.Guid? InputPortId { get; set; }

        [JsonProperty("reason")]
        public string Reason { get; set; }
    }

    internal sealed class UnresolvedConnectionDto
    {
        [JsonProperty("id")]
        public System.Guid? Id { get; set; }

        [JsonProperty("outputNodeId")]
        public System.Guid? OutputNodeId { get; set; }

        [JsonProperty("outputPortId")]
        public System.Guid? OutputPortId { get; set; }

        [JsonProperty("inputNodeId")]
        public System.Guid? InputNodeId { get; set; }

        [JsonProperty("inputPortId")]
        public System.Guid? InputPortId { get; set; }

        [JsonProperty("reason")]
        public string Reason { get; set; }
    }
}
