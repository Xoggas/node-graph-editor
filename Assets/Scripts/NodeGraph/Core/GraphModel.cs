using System;
using System.Collections.Generic;
using System.Linq;
using R3;
using UnityEngine;

namespace NodeGraph.Core
{
    public sealed class GraphModel : IDisposable
    {
        private readonly Dictionary<Guid, NodeModel> _nodes = new Dictionary<Guid, NodeModel>();
        private readonly Dictionary<Guid, Port> _ports = new Dictionary<Guid, Port>();
        private readonly List<Connection> _connections = new List<Connection>();
        private readonly Dictionary<Guid, IDisposable> _nodeSubscriptions = new Dictionary<Guid, IDisposable>();

        public Guid Id { get; }
        public NodeGraphRegistry Registry { get; }
        public IReadOnlyCollection<NodeModel> Nodes => _nodes.Values;
        public IReadOnlyList<Connection> Connections => _connections;
        public List<UnresolvedConnection> UnresolvedConnections { get; } = new List<UnresolvedConnection>();
        public Subject<GraphChange> Changes { get; } = new Subject<GraphChange>();
        public GraphViewport Viewport { get; private set; } = new GraphViewport(Vector2.zero, 1f);

        public GraphModel(NodeGraphRegistry registry, Guid? id = null)
        {
            Registry = registry ?? throw new ArgumentNullException(nameof(registry));
            Id = id ?? Guid.NewGuid();
        }

        public NodeModel AddNode(string typeId, Vector2 position)
        {
            return AddNode(Registry.Nodes.CreateNode(typeId, Guid.NewGuid()), position);
        }

        public NodeModel AddNode(NodeModel node, Vector2 position)
        {
            if (node == null)
            {
                throw new ArgumentNullException(nameof(node));
            }
            if (_nodes.ContainsKey(node.Id))
            {
                throw new RegistryException($"Node id '{node.Id}' already exists in this graph.");
            }

            foreach (var port in node.Ports)
            {
                if (port.Id == Guid.Empty || _ports.ContainsKey(port.Id))
                {
                    throw new RegistryException($"Port id '{port.Id}' is already used in this graph.");
                }
            }

            node.SetPosition(position);
            node.Attach(this);
            _nodes.Add(node.Id, node);
            foreach (var port in node.Ports)
            {
                _ports.Add(port.Id, port);
            }

            _nodeSubscriptions.Add(node.Id, node.Changes.Subscribe(change =>
            {
                Changes.OnNext(new GraphChange(GraphChangeKind.NodeChanged, node, message: change.Kind.ToString()));
            }));
            Changes.OnNext(new GraphChange(GraphChangeKind.NodeAdded, node));
            return node;
        }

        public bool RemoveNode(Guid nodeId)
        {
            if (!_nodes.TryGetValue(nodeId, out var node))
            {
                return false;
            }

            foreach (var connection in _connections.Where(x => x.OutputNode == node || x.InputNode == node).ToArray())
            {
                Disconnect(connection);
            }

            if (_nodeSubscriptions.TryGetValue(nodeId, out var subscription))
            {
                subscription.Dispose();
                _nodeSubscriptions.Remove(nodeId);
            }

            foreach (var port in node.Ports)
            {
                _ports.Remove(port.Id);
            }
            _nodes.Remove(nodeId);
            node.Detach();
            node.Dispose();
            Changes.OnNext(new GraphChange(GraphChangeKind.NodeRemoved, node));
            return true;
        }

        public ConnectionResult TryConnect(Port output, Port input)
        {
            return TryConnect(output, input, null);
        }

        internal ConnectionResult TryConnect(Port output, Port input, Guid? connectionId)
        {
            if (output == null || input == null)
            {
                return ConnectionResult.Failed(ConnectionFailureReason.NullPort, "Both ports are required.");
            }
            if (output.Owner == null || input.Owner == null || output.Owner.Graph != this || input.Owner.Graph != this)
            {
                return ConnectionResult.Failed(ConnectionFailureReason.DifferentGraphs, "Both ports must belong to this graph.");
            }
            if (output.Direction != PortDirection.Output || input.Direction != PortDirection.Input)
            {
                return ConnectionResult.Failed(ConnectionFailureReason.WrongDirection, "Connections must go from Output to Input.");
            }
            var outputTypeKnown = Registry.DataTypes.TryResolve(output.TypeId, out var outputType);
            var inputTypeKnown = Registry.DataTypes.TryResolve(input.TypeId, out var inputType);
            var hasPlaceholderEndpoint = output.Owner is IPlaceholderNode || input.Owner is IPlaceholderNode;
            if ((!outputTypeKnown || !inputTypeKnown) && !hasPlaceholderEndpoint)
            {
                return ConnectionResult.Failed(ConnectionFailureReason.UnknownDataType, "One of the port data types is not registered.");
            }
            if (outputTypeKnown && inputTypeKnown && !inputType.IsAssignableFrom(outputType))
            {
                return ConnectionResult.Failed(ConnectionFailureReason.IncompatibleTypes, $"'{output.TypeId}' cannot be connected to '{input.TypeId}'.");
            }
            if (input.Capacity == PortCapacity.Single && GetInputConnections(input).Any())
            {
                return ConnectionResult.Failed(ConnectionFailureReason.InputCapacityReached, "The input port already has a connection.");
            }
            if (_connections.Any(x => x.Output == output && x.Input == input))
            {
                return ConnectionResult.Failed(ConnectionFailureReason.DuplicateConnection, "This connection already exists.");
            }
            if (connectionId.HasValue && _connections.Any(x => x.Id == connectionId.Value))
            {
                return ConnectionResult.Failed(ConnectionFailureReason.DuplicateConnection, "A connection with this id already exists.");
            }

            var connection = new Connection(connectionId ?? Guid.NewGuid(), output, input);
            _connections.Add(connection);
            Changes.OnNext(new GraphChange(GraphChangeKind.ConnectionAdded, connection: connection));
            return ConnectionResult.Succeeded(connection);
        }

        public bool Disconnect(Connection connection)
        {
            if (connection == null || !_connections.Remove(connection))
            {
                return false;
            }
            Changes.OnNext(new GraphChange(GraphChangeKind.ConnectionRemoved, connection: connection));
            return true;
        }

        public IReadOnlyList<NodeModel> GetOutputNodes(Port output)
        {
            return _connections
                .Where(x => x.Output == output)
                .Select(x => x.InputNode)
                .ToArray();
        }

        public IReadOnlyList<NodeModel> GetInputNodes(Port input)
        {
            return _connections
                .Where(x => x.Input == input)
                .Select(x => x.OutputNode)
                .ToArray();
        }

        public IReadOnlyList<Connection> GetInputConnections(Port input)
        {
            return _connections.Where(x => x.Input == input).ToArray();
        }

        public IReadOnlyList<Connection> GetOutputConnections(Port output)
        {
            return _connections.Where(x => x.Output == output).ToArray();
        }

        public bool HasConnections(Port port)
        {
            return _connections.Any(x => x.Output == port || x.Input == port);
        }

        internal void RegisterPort(Port port)
        {
            if (port == null || port.Id == Guid.Empty)
            {
                throw new RegistryException("A dynamic port must have a non-empty id.");
            }
            if (_ports.TryGetValue(port.Id, out var existing) && !ReferenceEquals(existing, port))
            {
                throw new RegistryException($"Port id '{port.Id}' is already used in this graph.");
            }
            _ports[port.Id] = port;
        }

        internal void UnregisterPort(Port port)
        {
            if (port != null)
            {
                _ports.Remove(port.Id);
            }
        }

        public bool TryGetNode(Guid id, out NodeModel node)
        {
            return _nodes.TryGetValue(id, out node);
        }

        public bool TryGetPort(Guid id, out Port port)
        {
            return _ports.TryGetValue(id, out port);
        }

        public void SetViewport(GraphViewport viewport)
        {
            Viewport = viewport;
            Changes.OnNext(new GraphChange(GraphChangeKind.NodeChanged, message: "Viewport"));
        }

        public void AddUnresolvedConnection(UnresolvedConnection connection)
        {
            if (connection != null)
            {
                UnresolvedConnections.Add(connection);
            }
        }

        public void Dispose()
        {
            foreach (var subscription in _nodeSubscriptions.Values)
            {
                subscription.Dispose();
            }
            _nodeSubscriptions.Clear();
            foreach (var node in _nodes.Values.ToArray())
            {
                node.Detach();
                node.Dispose();
            }
            _nodes.Clear();
            _ports.Clear();
            _connections.Clear();
            Changes.Dispose();
        }
    }
}
