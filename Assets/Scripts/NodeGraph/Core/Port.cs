using System;

namespace NodeGraph.Core
{
    public sealed class Port
    {
        public Guid Id { get; private set; }
        public string Key { get; private set; }
        public PortDirection Direction { get; private set; }
        public PortCapacity Capacity { get; private set; }
        public string TypeId { get; private set; }
        public string DisplayName { get; private set; }
        public bool IsDynamic { get; private set; }
        public NodeModel Owner { get; internal set; }

        internal Port(Guid id, string key, PortDirection direction, PortCapacity capacity, string typeId, string displayName, bool isDynamic, NodeModel owner)
        {
            Id = id;
            Key = key;
            Direction = direction;
            Capacity = capacity;
            TypeId = typeId;
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? key : displayName;
            IsDynamic = isDynamic;
            Owner = owner;
        }

        internal void RestoreId(Guid id)
        {
            Id = id;
        }

        internal void RestoreDisplayName(string displayName)
        {
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? Key : displayName;
        }

        public override string ToString()
        {
            return $"{Owner?.TypeId ?? "Detached"}.{Key} ({Direction}, {TypeId})";
        }
    }
}
