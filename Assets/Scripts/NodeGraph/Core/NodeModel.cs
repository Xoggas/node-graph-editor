using System;
using System.Collections.Generic;
using System.Linq;
using R3;
using UnityEngine;

namespace NodeGraph.Core
{
    public abstract class NodeModel : IDisposable
    {
        private readonly List<Port> _ports = new List<Port>();
        private GraphModel _graph;
        private GraphTypeRegistry _typeRegistry;
        private string _displayName;

        public Guid Id { get; }
        public string TypeId { get; private set; }
        public Vector2 Position { get; private set; }
        public IReadOnlyList<Port> Ports => _ports;
        public virtual string DisplayName => string.IsNullOrWhiteSpace(_displayName) ? TypeId : _displayName;
        public Subject<NodeChange> Changes { get; } = new Subject<NodeChange>();

        protected NodeModel(Guid id)
        {
            if (id == Guid.Empty)
            {
                throw new ArgumentException("A node id must not be empty.", nameof(id));
            }
            Id = id;
        }

        public IReadOnlyList<NodeModel> GetOutputNodes(Port port)
        {
            ValidatePort(port, PortDirection.Output);
            return _graph == null ? Array.Empty<NodeModel>() : _graph.GetOutputNodes(port);
        }

        public IReadOnlyList<NodeModel> GetInputNodes(Port port)
        {
            ValidatePort(port, PortDirection.Input);
            return _graph == null ? Array.Empty<NodeModel>() : _graph.GetInputNodes(port);
        }

        public void SetPosition(Vector2 position)
        {
            if (Position == position)
            {
                return;
            }

            Position = position;
            RaiseChanged(NodeChangeKind.Position);
        }

        protected Port DefineInput(string key, Type dataType, string displayName = null, PortCapacity capacity = PortCapacity.Single)
        {
            return DefinePort(key, PortDirection.Input, _typeRegistry.GetId(dataType), displayName, capacity, false, null);
        }

        protected Port DefineOutput(string key, Type dataType, string displayName = null, PortCapacity capacity = PortCapacity.Multiple)
        {
            return DefinePort(key, PortDirection.Output, _typeRegistry.GetId(dataType), displayName, capacity, false, null);
        }

        public Port AddDynamicPort(PortDefinition definition)
        {
            if (definition == null)
            {
                throw new ArgumentNullException(nameof(definition));
            }
            if (!definition.IsDynamic)
            {
                throw new ArgumentException("AddDynamicPort requires a dynamic definition.", nameof(definition));
            }

            var port = DefinePort(
                definition.Key,
                definition.Direction,
                definition.TypeId,
                definition.DisplayName,
                definition.Capacity,
                true,
                definition.Id);
            try
            {
                _graph?.RegisterPort(port);
            }
            catch
            {
                _ports.Remove(port);
                throw;
            }
            RaiseChanged(NodeChangeKind.Ports);
            return port;
        }

        public bool RemoveDynamicPort(Port port)
        {
            ValidatePort(port, null);
            if (!port.IsDynamic || _graph != null && _graph.HasConnections(port))
            {
                return false;
            }

            _ports.Remove(port);
            _graph?.UnregisterPort(port);
            port.Owner = null;
            RaiseChanged(NodeChangeKind.Ports);
            return true;
        }

        internal void InitializeFresh(GraphTypeRegistry typeRegistry)
        {
            _typeRegistry = typeRegistry ?? throw new ArgumentNullException(nameof(typeRegistry));
            OnInitialize();
        }

        internal void RestorePorts(IReadOnlyList<PortSnapshot> snapshots)
        {
            if (snapshots == null)
            {
                throw new ArgumentNullException(nameof(snapshots));
            }

            var staticPorts = _ports.Where(x => !x.IsDynamic).ToDictionary(x => x.Key, StringComparer.Ordinal);
            _ports.RemoveAll(x => x.IsDynamic);

            var seenKeys = new HashSet<string>(StringComparer.Ordinal);
            var seenIds = new HashSet<Guid>();

            foreach (var snapshot in snapshots)
            {
                if (snapshot.Id == Guid.Empty)
                {
                    throw new RegistryException($"Node '{Id}' contains an empty port id.");
                }
                if (!seenKeys.Add(snapshot.Key))
                {
                    throw new RegistryException($"Node '{Id}' contains duplicate port key '{snapshot.Key}'.");
                }
                if (!seenIds.Add(snapshot.Id))
                {
                    throw new RegistryException($"Node '{Id}' contains duplicate port id '{snapshot.Id}'.");
                }
                _typeRegistry.Resolve(snapshot.TypeId);

                if (!snapshot.IsDynamic)
                {
                    if (!staticPorts.TryGetValue(snapshot.Key, out var staticPort))
                    {
                        throw new NodeSchemaMismatchException($"Static port '{snapshot.Key}' is not declared by '{TypeId}'.");
                    }
                    if (staticPort.Direction != snapshot.Direction ||
                        staticPort.Capacity != snapshot.Capacity ||
                        !string.Equals(staticPort.TypeId, snapshot.TypeId, StringComparison.Ordinal))
                    {
                        throw new NodeSchemaMismatchException($"Static port '{snapshot.Key}' does not match the '{TypeId}' schema.");
                    }

                    staticPort.RestoreId(snapshot.Id);
                    staticPort.RestoreDisplayName(snapshot.DisplayName);
                    continue;
                }

                if (staticPorts.ContainsKey(snapshot.Key))
                {
                    throw new NodeSchemaMismatchException($"Dynamic port '{snapshot.Key}' conflicts with a static port.");
                }

                _ports.Add(new Port(
                    snapshot.Id,
                    snapshot.Key,
                    snapshot.Direction,
                    snapshot.Capacity,
                    snapshot.TypeId,
                    snapshot.DisplayName,
                    true,
                    this));
            }

            foreach (var staticPort in staticPorts.Values)
            {
                if (!seenKeys.Contains(staticPort.Key))
                {
                    throw new NodeSchemaMismatchException($"Static port '{staticPort.Key}' is missing from the document.");
                }
            }

            OnPortsRestored();
            RaiseChanged(NodeChangeKind.Ports);
        }

        internal void RestoreAllPorts(IReadOnlyList<PortSnapshot> snapshots)
        {
            _ports.Clear();
            var ids = new HashSet<Guid>();
            foreach (var snapshot in snapshots)
            {
                if (snapshot.Id == Guid.Empty || !ids.Add(snapshot.Id))
                {
                    throw new RegistryException($"Node '{Id}' contains an invalid or duplicate port id.");
                }
                _ports.Add(new Port(
                    snapshot.Id,
                    snapshot.Key,
                    snapshot.Direction,
                    snapshot.Capacity,
                    snapshot.TypeId,
                    snapshot.DisplayName,
                    snapshot.IsDynamic,
                    this));
            }

            OnPortsRestored();
            RaiseChanged(NodeChangeKind.Ports);
        }

        internal void Attach(GraphModel graph)
        {
            _graph = graph ?? throw new ArgumentNullException(nameof(graph));
            foreach (var port in _ports)
            {
                port.Owner = this;
            }
        }

        internal void Detach()
        {
            _graph = null;
        }

        internal GraphModel Graph => _graph;
        internal GraphTypeRegistry TypeRegistry => _typeRegistry;

        internal void SetTypeId(string typeId)
        {
            TypeId = typeId;
        }

        internal void SetDisplayName(string displayName)
        {
            _displayName = displayName;
        }

        internal virtual Type StateType => null;
        internal virtual object CaptureStateObject() => null;
        internal virtual void RestoreStateObject(object state)
        {
        }

        protected virtual void OnInitialize()
        {
        }

        protected virtual void OnPortsRestored()
        {
        }

        protected void RaiseChanged(NodeChangeKind kind)
        {
            Changes.OnNext(new NodeChange(this, kind));
        }

        private Port DefinePort(string key, PortDirection direction, string typeId, string displayName, PortCapacity capacity, bool isDynamic, Guid? id)
        {
            if (_typeRegistry == null)
            {
                throw new InvalidOperationException("The node has not been initialized by a NodeTypeRegistry.");
            }
            if (string.IsNullOrWhiteSpace(key))
            {
                throw new ArgumentException("A port key is required.", nameof(key));
            }
            if (_ports.Any(x => string.Equals(x.Key, key, StringComparison.Ordinal)))
            {
                throw new RegistryException($"Node '{TypeId}' already contains port '{key}'.");
            }

            _typeRegistry.Resolve(typeId);
            var portId = id ?? Guid.NewGuid();
            if (portId == Guid.Empty)
            {
                throw new RegistryException($"Node '{TypeId}' contains an empty port id.");
            }
            var port = new Port(portId, key, direction, capacity, typeId, displayName, isDynamic, this);
            _ports.Add(port);
            return port;
        }

        private void ValidatePort(Port port, PortDirection? requiredDirection)
        {
            if (port == null)
            {
                throw new ArgumentNullException(nameof(port));
            }
            if (!ReferenceEquals(port.Owner, this))
            {
                throw new ArgumentException("The port does not belong to this node.", nameof(port));
            }
            if (requiredDirection.HasValue && port.Direction != requiredDirection.Value)
            {
                throw new ArgumentException($"Expected an {requiredDirection.Value} port.", nameof(port));
            }
        }

        public virtual void Dispose()
        {
            Changes.Dispose();
        }
    }

    public abstract class NodeModel<TState> : NodeModel
    {
        protected NodeModel(Guid id) : base(id)
        {
        }

        protected abstract TState CaptureState();
        protected abstract void RestoreState(TState state);

        internal override Type StateType => typeof(TState);
        internal override object CaptureStateObject() => CaptureState();
        internal override void RestoreStateObject(object state) => RestoreState((TState)state);
    }

    public interface IPlaceholderNode
    {
        string OriginalTypeId { get; }
        string RawStateJson { get; }
    }

    public sealed class NodeSchemaMismatchException : Exception
    {
        public NodeSchemaMismatchException(string message) : base(message)
        {
        }
    }
}
