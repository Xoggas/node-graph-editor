using System;
using NodeGraph.Core;
using UnityEngine;

namespace NodeGraph.Flow
{
    public readonly struct CreateNodeRequested : ISyncEvent
    {
        public string TypeId { get; }
        public Vector2 Position { get; }

        public CreateNodeRequested(string typeId, Vector2 position)
        {
            TypeId = typeId;
            Position = position;
        }
    }

    public readonly struct DeleteNodeRequested : ISyncEvent
    {
        public Guid NodeId { get; }

        public DeleteNodeRequested(Guid nodeId)
        {
            NodeId = nodeId;
        }
    }

    public readonly struct ConnectPortsRequested : ISyncEvent
    {
        public Guid OutputPortId { get; }
        public Guid InputPortId { get; }

        public ConnectPortsRequested(Guid outputPortId, Guid inputPortId)
        {
            OutputPortId = outputPortId;
            InputPortId = inputPortId;
        }
    }

    public readonly struct DisconnectConnectionRequested : ISyncEvent
    {
        public Guid ConnectionId { get; }

        public DisconnectConnectionRequested(Guid connectionId)
        {
            ConnectionId = connectionId;
        }
    }

    public readonly struct MoveNodeRequested : ISyncEvent
    {
        public Guid NodeId { get; }
        public Vector2 Position { get; }

        public MoveNodeRequested(Guid nodeId, Vector2 position)
        {
            NodeId = nodeId;
            Position = position;
        }
    }

    public readonly struct SetViewportRequested : ISyncEvent
    {
        public Vector2 Position { get; }
        public float Zoom { get; }

        public SetViewportRequested(Vector2 position, float zoom)
        {
            Position = position;
            Zoom = zoom;
        }
    }

    public readonly struct NewGraphRequested : ISyncEvent
    {
    }

    public readonly struct ReplaceGraphRequested : ISyncEvent
    {
        public GraphModel Graph { get; }
        public string FilePath { get; }
        public string Status { get; }

        public ReplaceGraphRequested(GraphModel graph, string filePath, string status)
        {
            Graph = graph;
            FilePath = filePath;
            Status = status;
        }
    }

    public readonly struct SaveCompletedRequested : ISyncEvent
    {
        public string FilePath { get; }

        public SaveCompletedRequested(string filePath)
        {
            FilePath = filePath;
        }
    }

    public readonly struct StatusRequested : ISyncEvent
    {
        public string Message { get; }

        public StatusRequested(string message)
        {
            Message = message;
        }
    }

    public readonly struct SetNumberValueRequested : ISyncEvent
    {
        public Guid NodeId { get; }
        public float Value { get; }

        public SetNumberValueRequested(Guid nodeId, float value)
        {
            NodeId = nodeId;
            Value = value;
        }
    }

    public readonly struct AddDynamicOutputRequested : ISyncEvent
    {
        public Guid NodeId { get; }

        public AddDynamicOutputRequested(Guid nodeId)
        {
            NodeId = nodeId;
        }
    }

    public readonly struct GraphReplacedEvent : ISyncEvent
    {
    }

    public readonly struct GraphSavedEvent : ISyncEvent
    {
        public string FilePath { get; }

        public GraphSavedEvent(string filePath)
        {
            FilePath = filePath;
        }
    }

    public readonly struct FilePathChangedEvent : ISyncEvent
    {
        public string FilePath { get; }

        public FilePathChangedEvent(string filePath)
        {
            FilePath = filePath;
        }
    }

    public readonly struct StatusChangedEvent : ISyncEvent
    {
        public string Message { get; }

        public StatusChangedEvent(string message)
        {
            Message = message;
        }
    }
}
