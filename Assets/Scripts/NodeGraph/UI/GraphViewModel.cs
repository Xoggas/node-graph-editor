using System;
using System.Collections.Generic;
using ObservableCollections;
using R3;
using NodeGraph.App;
using NodeGraph.Core;
using NodeGraph.Flow;
using UnityEngine;

namespace NodeGraph.UI
{
    public sealed class GraphViewModel : IDisposable
    {
        private readonly GraphSession _session;
        private readonly IEventBus _eventBus;
        private readonly Dictionary<Guid, NodeViewModel> _nodeViewModels = new Dictionary<Guid, NodeViewModel>();
        private readonly CompositeDisposable _eventSubscriptions = new CompositeDisposable();
        private readonly CompositeDisposable _graphSubscriptions = new CompositeDisposable();
        private GraphModel _graph;

        public IReadOnlyList<Connection> Connections => _graph.Connections;
        public ObservableList<NodeViewModel> Nodes { get; } = new ObservableList<NodeViewModel>();
        public ReactiveProperty<bool> IsDirty { get; } = new ReactiveProperty<bool>(false);
        public ReactiveProperty<string> CurrentFilePath { get; } = new ReactiveProperty<string>(string.Empty);
        public ReactiveProperty<string> Status { get; } = new ReactiveProperty<string>(string.Empty);
        public ReactiveProperty<Vector2> ViewportPosition { get; } = new ReactiveProperty<Vector2>(Vector2.zero);
        public ReactiveProperty<float> Zoom { get; } = new ReactiveProperty<float>(1f);

        public IDisposable SubscribeToChanges(Action<GraphChange> handler)
        {
            return _graph.Changes.Subscribe(handler);
        }

        public bool TryGetNode(Guid nodeId, out NodeModel node)
        {
            return _graph.TryGetNode(nodeId, out node);
        }

        public GraphViewModel(GraphSession session, IEventBus eventBus)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
            _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
            _eventSubscriptions.Add(_eventBus.Subscribe<GraphReplacedEvent>(_ => AttachGraph(_session.Graph)));
            _eventSubscriptions.Add(_eventBus.Subscribe<GraphSavedEvent>(OnGraphSaved));
            _eventSubscriptions.Add(_eventBus.Subscribe<FilePathChangedEvent>(OnFilePathChanged));
            _eventSubscriptions.Add(_eventBus.Subscribe<StatusChangedEvent>(OnStatusChanged));
            AttachGraph(_session.Graph);
        }

        public void RequestCreateNode(string typeId, Vector2 position)
        {
            _eventBus.Invoke(new CreateNodeRequested(typeId, position));
        }

        public void RequestDeleteNode(Guid nodeId)
        {
            _eventBus.Invoke(new DeleteNodeRequested(nodeId));
        }

        public void RequestConnect(Port output, Port input)
        {
            if (output == null || input == null)
            {
                return;
            }

            _eventBus.Invoke(new ConnectPortsRequested(output.Id, input.Id));
        }

        public void RequestDisconnect(Guid connectionId)
        {
            _eventBus.Invoke(new DisconnectConnectionRequested(connectionId));
        }

        public void RequestMoveNode(Guid nodeId, Vector2 position)
        {
            _eventBus.Invoke(new MoveNodeRequested(nodeId, position));
        }

        public void RequestViewport(Vector2 position, float zoom)
        {
            _eventBus.Invoke(new SetViewportRequested(position, Mathf.Clamp(zoom, 0.1f, 4f)));
        }

        public void RequestNewGraph()
        {
            _eventBus.Invoke(new NewGraphRequested());
        }

        public void RequestReplaceGraph(GraphModel graph, string filePath, string status)
        {
            _eventBus.Invoke(new ReplaceGraphRequested(graph, filePath, status));
        }

        public void RequestSaveCompleted(string filePath)
        {
            _eventBus.Invoke(new SaveCompletedRequested(filePath));
        }

        public void RequestStatus(string message)
        {
            _eventBus.Invoke(new StatusRequested(message));
        }

        private void AttachGraph(GraphModel graph)
        {
            if (graph == null)
            {
                throw new ArgumentNullException(nameof(graph));
            }

            _graphSubscriptions.Clear();
            foreach (var nodeViewModel in _nodeViewModels.Values)
            {
                nodeViewModel.Dispose();
            }

            _nodeViewModels.Clear();
            Nodes.Clear();
            _graph = graph;
            ViewportPosition.Value = graph.Viewport.Position;
            Zoom.Value = graph.Viewport.Zoom;

            foreach (var node in graph.Nodes)
            {
                AddNodeViewModel(node);
            }

            _graphSubscriptions.Add(graph.Changes.Subscribe(OnGraphChanged));
            IsDirty.Value = false;
        }

        private void OnGraphSaved(GraphSavedEvent evt)
        {
            IsDirty.Value = false;
        }

        private void OnFilePathChanged(FilePathChangedEvent evt)
        {
            CurrentFilePath.Value = evt.FilePath ?? string.Empty;
        }

        private void OnStatusChanged(StatusChangedEvent evt)
        {
            Status.Value = evt.Message ?? string.Empty;
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
            var viewModel = new NodeViewModel(node, _eventBus);
            _nodeViewModels.Add(node.Id, viewModel);
            Nodes.Add(viewModel);
        }

        public void Dispose()
        {
            _eventSubscriptions.Dispose();
            _graphSubscriptions.Dispose();
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
        }
    }

    public sealed class NodeViewModel : IDisposable
    {
        private readonly IEventBus _eventBus;
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();

        public NodeModel Model { get; }
        public ObservableList<PortViewModel> Ports { get; } = new ObservableList<PortViewModel>();
        public ReactiveProperty<Vector2> Position { get; }
        public string DisplayName => Model.DisplayName;
        public string TypeId => Model.TypeId;

        public NodeViewModel(NodeModel model, IEventBus eventBus)
        {
            Model = model ?? throw new ArgumentNullException(nameof(model));
            _eventBus = eventBus ?? throw new ArgumentNullException(nameof(eventBus));
            Position = new ReactiveProperty<Vector2>(model.Position);
            RebuildPorts();
            _subscriptions.Add(model.Changes.Subscribe(OnModelChanged));
        }

        public void RequestPosition(Vector2 position)
        {
            _eventBus.Invoke(new MoveNodeRequested(Model.Id, position));
        }

        public void RequestNumberValue(float value)
        {
            _eventBus.Invoke(new SetNumberValueRequested(Model.Id, value));
        }

        public void RequestAddDynamicOutput()
        {
            _eventBus.Invoke(new AddDynamicOutputRequested(Model.Id));
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
