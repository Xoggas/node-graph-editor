using System;
using System.Collections.Generic;
using ObservableCollections;
using R3;
using NodeGraph.Core;
using UnityEngine;

namespace NodeGraph.UI
{
    public sealed class GraphViewModel : IDisposable
    {
        private readonly Dictionary<Guid, NodeViewModel> _nodeViewModels = new Dictionary<Guid, NodeViewModel>();
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();
        private GraphModel _graph;

        public GraphModel Graph => _graph;
        public ObservableList<NodeViewModel> Nodes { get; } = new ObservableList<NodeViewModel>();
        public ReactiveProperty<bool> IsDirty { get; } = new ReactiveProperty<bool>(false);
        public ReactiveProperty<string> CurrentFilePath { get; } = new ReactiveProperty<string>(string.Empty);
        public ReactiveProperty<string> Status { get; } = new ReactiveProperty<string>(string.Empty);
        public ReactiveProperty<Vector2> ViewportPosition { get; } = new ReactiveProperty<Vector2>(Vector2.zero);
        public ReactiveProperty<float> Zoom { get; } = new ReactiveProperty<float>(1f);

        public GraphViewModel(GraphModel graph)
        {
            ReplaceGraph(graph, false);
        }

        public void ReplaceGraph(GraphModel graph, bool disposePrevious = true)
        {
            if (graph == null)
            {
                throw new ArgumentNullException(nameof(graph));
            }

            foreach (var nodeViewModel in _nodeViewModels.Values)
            {
                nodeViewModel.Dispose();
            }
            _nodeViewModels.Clear();
            Nodes.Clear();

            var previousGraph = _graph;
            if (disposePrevious && previousGraph != null)
            {
                previousGraph.Dispose();
            }

            _graph = graph;
            ViewportPosition.Value = graph.Viewport.Position;
            Zoom.Value = graph.Viewport.Zoom;

            foreach (var node in graph.Nodes)
            {
                AddNodeViewModel(node);
            }

            _subscriptions.Clear();
            _subscriptions.Add(graph.Changes.Subscribe(OnGraphChanged));
            IsDirty.Value = false;
        }

        public NodeViewModel CreateNode(string typeId, Vector2 position)
        {
            var node = _graph.AddNode(typeId, position);
            IsDirty.Value = true;
            return _nodeViewModels[node.Id];
        }

        public bool DeleteNode(Guid nodeId)
        {
            var result = _graph.RemoveNode(nodeId);
            if (result)
            {
                IsDirty.Value = true;
            }
            return result;
        }

        public ConnectionResult Connect(Port output, Port input)
        {
            var result = _graph.TryConnect(output, input);
            Status.Value = result.Success ? "Connected." : result.Message;
            if (result.Success)
            {
                IsDirty.Value = true;
            }
            return result;
        }

        public bool Disconnect(Connection connection)
        {
            var result = _graph.Disconnect(connection);
            if (result)
            {
                IsDirty.Value = true;
            }
            return result;
        }

        public void SetViewport(Vector2 position, float zoom)
        {
            ViewportPosition.Value = position;
            Zoom.Value = Mathf.Clamp(zoom, 0.1f, 4f);
            _graph.SetViewport(new GraphViewport(position, Zoom.Value));
            IsDirty.Value = true;
        }

        public void SetFilePath(string path)
        {
            CurrentFilePath.Value = path ?? string.Empty;
        }

        public void MarkSaved(string path)
        {
            SetFilePath(path);
            IsDirty.Value = false;
            Status.Value = $"Saved: {path}";
        }

        public void SetStatus(string status)
        {
            Status.Value = status ?? string.Empty;
        }

        private void OnGraphChanged(GraphChange change)
        {
            switch (change.Kind)
            {
                case GraphChangeKind.NodeAdded:
                    if (change.Node != null && !_nodeViewModels.ContainsKey(change.Node.Id))
                    {
                        AddNodeViewModel(change.Node);
                    }
                    break;
                case GraphChangeKind.NodeRemoved:
                    if (change.Node != null && _nodeViewModels.TryGetValue(change.Node.Id, out var nodeViewModel))
                    {
                        Nodes.Remove(nodeViewModel);
                        _nodeViewModels.Remove(change.Node.Id);
                        nodeViewModel.Dispose();
                    }
                    break;
            }

            if (change.Kind != GraphChangeKind.NodeChanged || !string.Equals(change.Message, "Viewport", StringComparison.Ordinal))
            {
                IsDirty.Value = true;
            }
        }

        private void AddNodeViewModel(NodeModel node)
        {
            var viewModel = new NodeViewModel(node);
            _nodeViewModels.Add(node.Id, viewModel);
            Nodes.Add(viewModel);
        }

        public void Dispose()
        {
            _subscriptions.Dispose();
            foreach (var nodeViewModel in _nodeViewModels.Values)
            {
                nodeViewModel.Dispose();
            }
            _nodeViewModels.Clear();
            Nodes.Clear();
            IsDirty.Dispose();
            CurrentFilePath.Dispose();
            Status.Dispose();
            ViewportPosition.Dispose();
            Zoom.Dispose();
            _graph?.Dispose();
        }
    }

    public sealed class NodeViewModel : IDisposable
    {
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();

        public NodeModel Model { get; }
        public ObservableList<PortViewModel> Ports { get; } = new ObservableList<PortViewModel>();
        public ReactiveProperty<Vector2> Position { get; }
        public string DisplayName => Model.DisplayName;
        public string TypeId => Model.TypeId;

        public NodeViewModel(NodeModel model)
        {
            Model = model ?? throw new ArgumentNullException(nameof(model));
            Position = new ReactiveProperty<Vector2>(model.Position);
            RebuildPorts();
            _subscriptions.Add(model.Changes.Subscribe(OnModelChanged));
        }

        public void SetPosition(Vector2 position)
        {
            Model.SetPosition(position);
            Position.Value = position;
        }

        private void OnModelChanged(NodeChange change)
        {
            if (change.Kind == NodeChangeKind.Position)
            {
                Position.Value = Model.Position;
            }
            else if (change.Kind == NodeChangeKind.Ports)
            {
                RebuildPorts();
            }
        }

        private void RebuildPorts()
        {
            Ports.Clear();
            foreach (var port in Model.Ports)
            {
                Ports.Add(new PortViewModel(port));
            }
        }

        public void Dispose()
        {
            _subscriptions.Dispose();
            foreach (var port in Ports)
            {
                port.Dispose();
            }
            Ports.Clear();
            Position.Dispose();
        }
    }

    public sealed class PortViewModel : IDisposable
    {
        public Port Model { get; }
        public string DisplayName => Model.DisplayName;
        public PortDirection Direction => Model.Direction;
        public string TypeId => Model.TypeId;

        public PortViewModel(Port model)
        {
            Model = model ?? throw new ArgumentNullException(nameof(model));
        }

        public void Dispose()
        {
        }
    }
}
