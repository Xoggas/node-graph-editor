using System;
using UnityEngine;

namespace NodeGraph.Core
{
    public enum PortDirection
    {
        Input,
        Output
    }

    public enum PortCapacity
    {
        Single,
        Multiple
    }

    public enum ConnectionFailureReason
    {
        None,
        NullPort,
        DifferentGraphs,
        WrongDirection,
        UnknownDataType,
        IncompatibleTypes,
        InputCapacityReached,
        DuplicateConnection,
        MissingEndpoint,
        InvalidPort
    }

    public readonly struct ConnectionResult
    {
        public bool Success { get; }
        public Connection Connection { get; }
        public ConnectionFailureReason FailureReason { get; }
        public string Message { get; }

        private ConnectionResult(bool success, Connection connection, ConnectionFailureReason failureReason, string message)
        {
            Success = success;
            Connection = connection;
            FailureReason = failureReason;
            Message = message;
        }

        public static ConnectionResult Succeeded(Connection connection)
        {
            return new ConnectionResult(true, connection, ConnectionFailureReason.None, string.Empty);
        }

        public static ConnectionResult Failed(ConnectionFailureReason reason, string message)
        {
            return new ConnectionResult(false, null, reason, message);
        }
    }

    public enum GraphChangeKind
    {
        NodeAdded,
        NodeRemoved,
        NodeChanged,
        PortAdded,
        PortRemoved,
        ConnectionAdded,
        ConnectionRemoved,
        GraphReplaced,
        Diagnostic
    }

    public readonly struct GraphChange
    {
        public GraphChangeKind Kind { get; }
        public NodeModel Node { get; }
        public Port Port { get; }
        public Connection Connection { get; }
        public string Message { get; }

        public GraphChange(GraphChangeKind kind, NodeModel node = null, Port port = null, Connection connection = null, string message = null)
        {
            Kind = kind;
            Node = node;
            Port = port;
            Connection = connection;
            Message = message ?? string.Empty;
        }
    }

    public enum NodeChangeKind
    {
        Position,
        State,
        Ports,
        Metadata
    }

    public readonly struct NodeChange
    {
        public NodeModel Node { get; }
        public NodeChangeKind Kind { get; }

        public NodeChange(NodeModel node, NodeChangeKind kind)
        {
            Node = node;
            Kind = kind;
        }
    }

    public readonly struct PortSnapshot
    {
        public Guid Id { get; }
        public string Key { get; }
        public PortDirection Direction { get; }
        public PortCapacity Capacity { get; }
        public string TypeId { get; }
        public string DisplayName { get; }
        public bool IsDynamic { get; }

        public PortSnapshot(Guid id, string key, PortDirection direction, PortCapacity capacity, string typeId, string displayName, bool isDynamic)
        {
            Id = id;
            Key = key;
            Direction = direction;
            Capacity = capacity;
            TypeId = typeId;
            DisplayName = displayName ?? key;
            IsDynamic = isDynamic;
        }
    }

    public sealed class PortDefinition
    {
        public string Key { get; }
        public PortDirection Direction { get; }
        public PortCapacity Capacity { get; }
        public string TypeId { get; }
        public string DisplayName { get; }
        public bool IsDynamic { get; }
        public Guid? Id { get; }

        public PortDefinition(string key, PortDirection direction, string typeId, PortCapacity capacity, string displayName = null, bool isDynamic = true, Guid? id = null)
        {
            Key = key;
            Direction = direction;
            TypeId = typeId;
            Capacity = capacity;
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? key : displayName;
            IsDynamic = isDynamic;
            Id = id;
        }
    }

    public sealed class UnresolvedConnection
    {
        public Guid? Id { get; set; }
        public Guid? OutputNodeId { get; set; }
        public Guid? OutputPortId { get; set; }
        public Guid? InputNodeId { get; set; }
        public Guid? InputPortId { get; set; }
        public string Reason { get; set; }

        public UnresolvedConnection()
        {
        }

        public UnresolvedConnection(Guid? id, Guid? outputNodeId, Guid? outputPortId, Guid? inputNodeId, Guid? inputPortId, string reason)
        {
            Id = id;
            OutputNodeId = outputNodeId;
            OutputPortId = outputPortId;
            InputNodeId = inputNodeId;
            InputPortId = inputPortId;
            Reason = reason;
        }
    }

    public readonly struct GraphViewport
    {
        public Vector2 Position { get; }
        public float Zoom { get; }

        public GraphViewport(Vector2 position, float zoom)
        {
            Position = position;
            Zoom = Mathf.Clamp(zoom, 0.1f, 4f);
        }
    }
}
