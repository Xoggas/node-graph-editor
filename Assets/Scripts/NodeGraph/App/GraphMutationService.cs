using System;
using NodeGraph.Core;

namespace NodeGraph.App
{
    public interface IGraphMutationService
    {
        void AddNode(string typeId, UnityEngine.Vector2 position);
        bool DeleteNode(Guid nodeId);
        ConnectionResult Connect(Guid outputPortId, Guid inputPortId);
        bool Disconnect(Guid connectionId);
        bool MoveNode(Guid nodeId, UnityEngine.Vector2 position);
        void SetViewport(UnityEngine.Vector2 position, float zoom);
    }

    public sealed class GraphMutationService : IGraphMutationService
    {
        private readonly GraphSession _session;

        public GraphMutationService(GraphSession session)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
        }

        public void AddNode(string typeId, UnityEngine.Vector2 position)
        {
            _session.Graph.AddNode(typeId, position);
        }

        public bool DeleteNode(Guid nodeId)
        {
            return _session.Graph.RemoveNode(nodeId);
        }

        public ConnectionResult Connect(Guid outputPortId, Guid inputPortId)
        {
            if (!_session.Graph.TryGetPort(outputPortId, out var output) ||
                !_session.Graph.TryGetPort(inputPortId, out var input))
            {
                return ConnectionResult.Failed(ConnectionFailureReason.MissingEndpoint, "The connection endpoint was not found.");
            }

            return _session.Graph.TryConnect(output, input);
        }

        public bool Disconnect(Guid connectionId)
        {
            foreach (var connection in _session.Graph.Connections)
            {
                if (connection.Id != connectionId)
                {
                    continue;
                }

                return _session.Graph.Disconnect(connection);
            }

            return false;
        }

        public bool MoveNode(Guid nodeId, UnityEngine.Vector2 position)
        {
            if (!_session.Graph.TryGetNode(nodeId, out var node))
            {
                return false;
            }

            node.SetPosition(position);
            return true;
        }

        public void SetViewport(UnityEngine.Vector2 position, float zoom)
        {
            _session.Graph.SetViewport(new GraphViewport(position, zoom));
        }
    }
}
