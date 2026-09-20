using System;
using System.Collections.Generic;
using System.Linq;
using R3;
using NodeGraph.Core;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public sealed class GraphCanvas : VisualElement, IDisposable
    {
        private readonly GraphViewModel _viewModel;
        private readonly NodeViewRegistry _viewRegistry;
        private readonly VisualElement _edgeLayer;
        private readonly VisualElement _nodeLayer;
        private readonly Dictionary<Guid, NodeView> _nodeViews = new Dictionary<Guid, NodeView>();
        private readonly Dictionary<Guid, PortView> _portViews = new Dictionary<Guid, PortView>();
        private readonly List<GraphEdgeView> _edgeViews = new List<GraphEdgeView>();
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();
        private NodeView _selectedNode;
        private PortView _pendingPort;
        private bool _panning;
        private Vector2 _panStartPointer;
        private Vector2 _panStartPosition;

        public GraphCanvas(GraphViewModel viewModel, NodeViewRegistry viewRegistry)
        {
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _viewRegistry = viewRegistry ?? throw new ArgumentNullException(nameof(viewRegistry));
            AddToClassList("node-graph-canvas");
            style.flexGrow = 1;
            focusable = true;

            var template = Resources.Load<VisualTreeAsset>("NodeGraph/GraphCanvas");
            if (template == null)
            {
                throw new InvalidOperationException("Missing graph canvas UXML at Resources/NodeGraph/GraphCanvas.uxml.");
            }
            template.CloneTree(this);

            var canvasStyle = Resources.Load<StyleSheet>("NodeGraph/GraphCanvas");
            if (canvasStyle != null)
            {
                styleSheets.Add(canvasStyle);
            }

            _edgeLayer = this.Q<VisualElement>("edge-layer");
            _nodeLayer = this.Q<VisualElement>("node-layer");
            if (_edgeLayer == null || _nodeLayer == null)
            {
                throw new InvalidOperationException("GraphCanvas.uxml does not contain edge-layer and node-layer.");
            }

            _edgeLayer.pickingMode = PickingMode.Ignore;
            _edgeLayer.style.position = Position.Absolute;
            _edgeLayer.style.left = 0;
            _edgeLayer.style.top = 0;
            _edgeLayer.style.right = 0;
            _edgeLayer.style.bottom = 0;
            _nodeLayer.style.position = Position.Absolute;
            _nodeLayer.style.left = 0;
            _nodeLayer.style.top = 0;
            _nodeLayer.style.right = 0;
            _nodeLayer.style.bottom = 0;

            RegisterCallback<PointerDownEvent>(OnPointerDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove);
            RegisterCallback<PointerUpEvent>(OnPointerUp);
            RegisterCallback<WheelEvent>(OnWheel);
            RegisterCallback<GeometryChangedEvent>(_ => RefreshEdges());

            _subscriptions.Add(_viewModel.Graph.Changes.Subscribe(OnGraphChanged));
            RebuildNodes();
        }

        private void OnGraphChanged(GraphChange change)
        {
            if (change.Kind == GraphChangeKind.NodeAdded ||
                change.Kind == GraphChangeKind.NodeRemoved ||
                change.Kind == GraphChangeKind.ConnectionAdded ||
                change.Kind == GraphChangeKind.ConnectionRemoved ||
                change.Message == NodeChangeKind.Ports.ToString())
            {
                RebuildNodes();
            }
            else
            {
                ApplyLayout();
                RefreshEdges();
            }
        }

        private void RebuildNodes()
        {
            foreach (var nodeView in _nodeViews.Values)
            {
                nodeView.Dispose();
            }
            _nodeViews.Clear();
            _portViews.Clear();
            _nodeLayer.Clear();

            foreach (var nodeViewModel in _viewModel.Nodes)
            {
                var nodeView = _viewRegistry.Create(nodeViewModel);
                nodeView.Selected += OnNodeSelected;
                nodeView.DragMoved += OnNodeDragged;
                nodeView.DeleteRequested += OnDeleteRequested;
                nodeView.ConnectionRequested += OnConnectionRequested;
                nodeView.ConnectionReleased += OnConnectionReleased;
                _nodeViews.Add(nodeViewModel.Model.Id, nodeView);
                _nodeLayer.Add(nodeView);

                foreach (var portView in nodeView.PortViews)
                {
                    _portViews[portView.ViewModel.Model.Id] = portView;
                }
            }

            ApplyLayout();
            RefreshEdges();
        }

        private void ApplyLayout()
        {
            var zoom = _viewModel.Zoom.Value;
            var pan = _viewModel.ViewportPosition.Value;
            foreach (var pair in _nodeViews)
            {
                if (_viewModel.Graph.TryGetNode(pair.Key, out var model))
                {
                    pair.Value.ApplyGraphPosition(model.Position, zoom, pan);
                }
            }
        }

        private void RefreshEdges()
        {
            foreach (var edgeView in _edgeViews)
            {
                edgeView.RemoveFromHierarchy();
            }
            _edgeViews.Clear();

            foreach (var connection in _viewModel.Graph.Connections)
            {
                var edgeView = new GraphEdgeView(connection, GetPortPosition);
                _edgeViews.Add(edgeView);
                _edgeLayer.Add(edgeView);
            }

            foreach (var edgeView in _edgeViews)
            {
                edgeView.Refresh();
            }
        }

        private Vector2? GetPortPosition(Guid portId)
        {
            if (!_portViews.TryGetValue(portId, out var portView) || portView.panel == null)
            {
                return null;
            }
            return _edgeLayer.WorldToLocal(portView.worldBound.center);
        }

        private void OnNodeSelected(NodeView nodeView)
        {
            if (_selectedNode != null)
            {
                _selectedNode.RemoveFromClassList("selected");
            }
            _selectedNode = nodeView;
            _selectedNode?.AddToClassList("selected");
        }

        private void OnNodeDragged(NodeView nodeView, PointerMoveEvent evt)
        {
            var position = nodeView.GetDragPosition(evt.position, _viewModel.Zoom.Value);
            nodeView.ViewModel.SetPosition(position);
            ApplyLayout();
            RefreshEdges();
        }

        private void OnDeleteRequested(NodeView nodeView)
        {
            _viewModel.DeleteNode(nodeView.ViewModel.Model.Id);
        }

        private void OnConnectionRequested(PortView portView)
        {
            _pendingPort = portView;
            _viewModel.SetStatus($"Connecting from {portView.ViewModel.DisplayName}...");
        }

        private void OnConnectionReleased(PortView portView)
        {
            if (_pendingPort == null || _pendingPort == portView)
            {
                return;
            }

            var first = _pendingPort.ViewModel.Model;
            var second = portView.ViewModel.Model;
            var output = first.Direction == PortDirection.Output ? first : second;
            var input = first.Direction == PortDirection.Input ? first : second;
            if (output.Direction == PortDirection.Output && input.Direction == PortDirection.Input)
            {
                _viewModel.Connect(output, input);
            }
            else
            {
                _viewModel.SetStatus("A connection must go from Output to Input.");
            }
            _pendingPort = null;
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (evt.button != 2 || evt.target != this)
            {
                return;
            }

            _panning = true;
            _panStartPointer = evt.position;
            _panStartPosition = _viewModel.ViewportPosition.Value;
            evt.StopPropagation();
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (!_panning)
            {
                return;
            }

            var currentPointer = new Vector2(evt.position.x, evt.position.y);
            var delta = currentPointer - _panStartPointer;
            _viewModel.SetViewport(_panStartPosition + delta, _viewModel.Zoom.Value);
            ApplyLayout();
            RefreshEdges();
            evt.StopPropagation();
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (!_panning)
            {
                return;
            }
            _panning = false;
            evt.StopPropagation();
        }

        private void OnWheel(WheelEvent evt)
        {
            var factor = evt.delta.y > 0 ? 0.9f : 1.1f;
            _viewModel.SetViewport(_viewModel.ViewportPosition.Value, _viewModel.Zoom.Value * factor);
            ApplyLayout();
            RefreshEdges();
            evt.StopPropagation();
        }

        public void Dispose()
        {
            _subscriptions.Dispose();
            foreach (var nodeView in _nodeViews.Values)
            {
                nodeView.Dispose();
            }
            _nodeViews.Clear();
            _portViews.Clear();
        }
    }
}
