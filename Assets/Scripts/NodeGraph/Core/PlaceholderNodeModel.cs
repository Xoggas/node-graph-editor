using System;

namespace NodeGraph.Core
{
    public sealed class PlaceholderNodeModel : NodeModel, IPlaceholderNode
    {
        public string OriginalTypeId { get; }
        public string RawStateJson { get; private set; }
        public override string DisplayName => $"Missing: {OriginalTypeId}";

        public PlaceholderNodeModel(Guid id, string originalTypeId, string rawStateJson)
            : base(id)
        {
            OriginalTypeId = originalTypeId ?? string.Empty;
            RawStateJson = rawStateJson ?? "{}";
            SetTypeId(OriginalTypeId);
        }

        public void SetRawStateJson(string rawStateJson)
        {
            RawStateJson = rawStateJson ?? "{}";
            RaiseChanged(NodeChangeKind.State);
        }

        internal void InitializePlaceholder(GraphTypeRegistry typeRegistry, System.Collections.Generic.IReadOnlyList<PortSnapshot> ports)
        {
            InitializeFresh(typeRegistry);
            RestoreAllPorts(ports);
        }
    }
}
