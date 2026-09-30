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
        private readonly VisualElement _canvasRoot;
        private readonly VisualElement _gridLayer;
        private readonly VisualElement _edgeLayer;
        private readonly VisualElement _nodeLayer;
        private readonly VisualElement _selectionLayer;
        private readonly VisualElement _selectionRect;
        private readonly VisualElement _connectionPreviewLayer;
        private readonly Dictionary<Guid, NodeView> _nodeViews = new Dictionary<Guid, NodeView>();
        private readonly Dictionary<Guid, PortView> _portViews = new Dictionary<Guid, PortView>();
        private readonly HashSet<NodeView> _selectedNodes = new HashSet<NodeView>();
        private readonly List<GraphEdgeView> _edgeViews = new List<GraphEdgeView>();
        private readonly Dictionary<NodeView, Vector2> _dragStartPositions = new Dictionary<NodeView, Vector2>();
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();
        private NodeView _selectedNode;
        private Guid? _selectedConnectionId;
        private PortView _pendingPort;
        private int _connectionPointerId = -1;
        private int _panPointerId = -1;
        private int _selectionPointerId = -1;
        private Vector2 _connectionPointerPosition;
        private Vector2 _selectionStartPanel;
        private Vector2 _selectionStartCanvas;
        private bool _selectionAdditive;
        private bool _selectionToggle;
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

            _canvasRoot = this.Q<VisualElement>("canvas-root");
            _gridLayer = this.Q<VisualElement>("grid-layer");
            _edgeLayer = this.Q<VisualElement>("edge-layer");
            _nodeLayer = this.Q<VisualElement>("node-layer");
            _selectionLayer = this.Q<VisualElement>("selection-layer");
            _selectionRect = this.Q<VisualElement>("selection-rect");
            _connectionPreviewLayer = this.Q<VisualElement>("connection-preview-layer");
            if (_canvasRoot == null || _gridLayer == null || _edgeLayer == null || _nodeLayer == null ||
                _selectionLayer == null || _selectionRect == null || _connectionPreviewLayer == null)
            {
                throw new InvalidOperationException("GraphCanvas.uxml does not contain the required canvas layers.");
            }

            _gridLayer.pickingMode = PickingMode.Ignore;
            _edgeLayer.pickingMode = PickingMode.Ignore;
            _selectionLayer.pickingMode = PickingMode.Ignore;
            _selectionRect.pickingMode = PickingMode.Ignore;
            _connectionPreviewLayer.pickingMode = PickingMode.Ignore;
            _selectionRect.style.display = DisplayStyle.None;
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

            _gridLayer.generateVisualContent += OnGenerateGridContent;
            _connectionPreviewLayer.generateVisualContent += OnGenerateConnectionPreview;
            RegisterCallback<PointerDownEvent>(OnPointerDown, TrickleDown.TrickleDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove, TrickleDown.TrickleDown);
            RegisterCallback<PointerUpEvent>(OnPointerUp, TrickleDown.TrickleDown);
            RegisterCallback<WheelEvent>(OnWheel);
            _canvasRoot.RegisterCallback<GeometryChangedEvent>(_ => RefreshEdges());

            _subscriptions.Add(_viewModel.SubscribeToChanges(OnGraphChanged));
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
                MarkCanvasDirty();
            }
        }

        private void OnGenerateGridContent(MeshGenerationContext context)
        {
            var spacing = Mathf.Max(12f, 32f * _viewModel.Zoom.Value);
            var viewportPosition = _viewModel.ViewportPosition.Value;
            var offsetX = Mathf.Repeat(viewportPosition.x, spacing);
            var offsetY = Mathf.Repeat(viewportPosition.y, spacing);
            var rect = _canvasRoot.contentRect;
            var painter = context.painter2D;
            var minorGridColor = new Color(0.2f, 0.21f, 0.23f, 0.07f);
            var majorGridColor = new Color(0.26f, 0.27f, 0.3f, 0.1f);
            var majorSpacing = spacing * 5f;
            var majorOffsetX = Mathf.Repeat(viewportPosition.x, majorSpacing);
            var majorOffsetY = Mathf.Repeat(viewportPosition.y, majorSpacing);

            painter.lineWidth = 1f;
            painter.strokeColor = minorGridColor;

            for (var x = rect.xMin + offsetX; x <= rect.xMax; x += spacing)
            {
                painter.BeginPath();
                painter.MoveTo(new Vector2(x, rect.yMin));
                painter.LineTo(new Vector2(x, rect.yMax));
                painter.Stroke();
            }

            painter.strokeColor = majorGridColor;

            for (var x = rect.xMin + majorOffsetX; x <= rect.xMax; x += majorSpacing)
            {
                painter.BeginPath();
                painter.MoveTo(new Vector2(x, rect.yMin));
                painter.LineTo(new Vector2(x, rect.yMax));
                painter.Stroke();
            }

            for (var y = rect.yMin + offsetY; y <= rect.yMax; y += spacing)
            {
                painter.BeginPath();
                painter.MoveTo(new Vector2(rect.xMin, y));
                painter.LineTo(new Vector2(rect.xMax, y));
                painter.Stroke();
            }

            for (var y = rect.yMin + majorOffsetY; y <= rect.yMax; y += majorSpacing)
            {
                painter.BeginPath();
                painter.MoveTo(new Vector2(rect.xMin, y));
                painter.LineTo(new Vector2(rect.xMax, y));
                painter.Stroke();
            }
        }

        private void OnGenerateConnectionPreview(MeshGenerationContext context)
        {
            if (_pendingPort == null || _connectionPointerId < 0)
            {
                return;
            }

            if (_pendingPort.panel == null)
            {
                return;
            }

            var end = _connectionPreviewLayer.WorldToLocal(_connectionPointerPosition);
            var canvasStart = _connectionPreviewLayer.WorldToLocal(_pendingPort.WorldConnectionPoint);
            var painter = context.painter2D;
            var direction = _pendingPort.ViewModel.Direction == PortDirection.Output ? 1f : -1f;
            DrawCurve(painter, canvasStart, end, direction, GraphVisualColors.Connection, 2.5f);
        }

        private static void DrawCurve(Painter2D painter, Vector2 start, Vector2 end, float direction, Color color, float lineWidth)
        {
            var tangent = Mathf.Max(36f, Mathf.Abs(end.x - start.x) * 0.45f);
            painter.lineWidth = lineWidth;
            painter.strokeColor = color;
            painter.BeginPath();
            painter.MoveTo(start);
            painter.BezierCurveTo(
                start + new Vector2(tangent * direction, 0),
                end - new Vector2(tangent * direction, 0),
                end);
            painter.Stroke();
        }

        private void RebuildNodes()
        {
            ClearSelection();
            foreach (var nodeView in _nodeViews.Values)
            {
                nodeView.LayoutChanged -= OnNodeLayoutChanged;
                nodeView.Dispose();
            }
            _nodeViews.Clear();
            _portViews.Clear();
            _nodeLayer.Clear();

            foreach (var nodeViewModel in _viewModel.Nodes)
            {
                var nodeView = _viewRegistry.Create(nodeViewModel);
                nodeView.DragStarted += OnNodeDragStarted;
                nodeView.DragMoved += OnNodeDragged;
                nodeView.DragEnded += OnNodeDragEnded;
                nodeView.LayoutChanged += OnNodeLayoutChanged;
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
                if (_viewModel.TryGetNode(pair.Key, out var model))
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

            var selectedConnectionExists = false;
            foreach (var connection in _viewModel.Connections)
            {
                var edgeView = new GraphEdgeView(connection, GetPortPosition, GetNodeBounds);
                if (_selectedConnectionId.HasValue && connection.Id == _selectedConnectionId.Value)
                {
                    edgeView.SetSelected(true);
                    selectedConnectionExists = true;
                }

                _edgeViews.Add(edgeView);
                _edgeLayer.Add(edgeView);
            }

            if (_selectedConnectionId.HasValue && !selectedConnectionExists)
            {
                _selectedConnectionId = null;
            }

            foreach (var edgeView in _edgeViews)
            {
                edgeView.Refresh();
            }

            MarkCanvasDirty();
        }

        private void MarkCanvasDirty()
        {
            MarkDirtyRepaint();
            _gridLayer.MarkDirtyRepaint();
            _canvasRoot.MarkDirtyRepaint();
            _connectionPreviewLayer.MarkDirtyRepaint();
        }

        private Vector2? GetPortPosition(Guid portId)
        {
            if (!_portViews.TryGetValue(portId, out var portView) || portView.panel == null)
            {
                return null;
            }
            return _edgeLayer.WorldToLocal(portView.WorldConnectionPoint);
        }

        private Rect? GetNodeBounds(Guid nodeId)
        {
            if (!_nodeViews.TryGetValue(nodeId, out var nodeView) || nodeView.panel == null)
            {
                return null;
            }

            return _edgeLayer.WorldToLocal(nodeView.worldBound);
        }

        private void OnNodeLayoutChanged(NodeView nodeView)
        {
            RefreshEdges();
        }

        private void SelectNodeFromPointer(NodeView nodeView, PointerDownEvent evt)
        {
            ClearConnectionSelection();

            if (evt.ctrlKey || evt.commandKey)
            {
                ToggleSelection(nodeView);
                return;
            }

            if (evt.shiftKey)
            {
                AddToSelection(nodeView);
                return;
            }

            if (_selectedNodes.Contains(nodeView))
            {
                return;
            }

            ClearSelection();
            AddToSelection(nodeView);
        }

        private void OnNodeDragStarted(NodeView nodeView, PointerDownEvent evt)
        {
            _dragStartPositions.Clear();

            foreach (var selectedNode in _selectedNodes)
            {
                _dragStartPositions[selectedNode] = selectedNode.ViewModel.Position.Value;
            }
        }

        private void OnNodeDragEnded(NodeView nodeView, PointerUpEvent evt)
        {
            _dragStartPositions.Clear();
        }

        private void OnNodeDragged(NodeView nodeView, PointerMoveEvent evt)
        {
            if (!_dragStartPositions.TryGetValue(nodeView, out var startPosition))
            {
                return;
            }

            var position = nodeView.GetDragPosition(evt.position, _viewModel.Zoom.Value);
            var delta = position - startPosition;
            foreach (var pair in _dragStartPositions)
            {
                pair.Key.ViewModel.RequestPosition(pair.Value + delta);
            }

            ApplyLayout();
            RefreshEdges();
        }

        private void ClearSelection()
        {
            foreach (var nodeView in _selectedNodes)
            {
                nodeView.SetSelected(false);
            }

            _selectedNodes.Clear();
            _selectedNode = null;
        }

        private void ToggleSelection(NodeView nodeView)
        {
            if (_selectedNodes.Remove(nodeView))
            {
                nodeView.SetSelected(false);
                if (_selectedNode == nodeView)
                {
                    _selectedNode = null;
                    foreach (var selectedNode in _selectedNodes)
                    {
                        _selectedNode = selectedNode;
                        break;
                    }
                }

                return;
            }

            AddToSelection(nodeView);
        }

        private void ClearConnectionSelection()
        {
            if (!_selectedConnectionId.HasValue)
            {
                return;
            }

            foreach (var edgeView in _edgeViews)
            {
                edgeView.SetSelected(false);
            }

            _selectedConnectionId = null;
        }

        private void SelectConnection(Connection connection)
        {
            if (connection == null)
            {
                return;
            }

            ClearSelection();
            ClearConnectionSelection();
            _selectedConnectionId = connection.Id;

            foreach (var edgeView in _edgeViews)
            {
                if (edgeView.Connection.Id == connection.Id)
                {
                    edgeView.SetSelected(true);
                    break;
                }
            }

            _viewModel.RequestStatus("Connection selected.");
        }

        private void AddToSelection(NodeView nodeView)
        {
            if (nodeView == null || !_selectedNodes.Add(nodeView))
            {
                return;
            }

            nodeView.SetSelected(true);
            _selectedNode = nodeView;
        }

        private void BeginSelection(Vector2 panelPosition, int pointerId, bool additive, bool toggle)
        {
            ClearConnectionSelection();
            if (!additive && !toggle)
            {
                ClearSelection();
            }

            _selectionAdditive = additive;
            _selectionToggle = toggle;
            Focus();
            _selectionPointerId = pointerId;
            _selectionStartPanel = panelPosition;
            _selectionStartCanvas = _selectionLayer.WorldToLocal(panelPosition);
            _selectionRect.style.display = DisplayStyle.Flex;
            UpdateSelectionRectangle(panelPosition);
        }

        private void UpdateSelectionRectangle(Vector2 panelPosition)
        {
            var currentCanvas = _selectionLayer.WorldToLocal(panelPosition);
            var xMin = Mathf.Min(_selectionStartCanvas.x, currentCanvas.x);
            var yMin = Mathf.Min(_selectionStartCanvas.y, currentCanvas.y);
            var xMax = Mathf.Max(_selectionStartCanvas.x, currentCanvas.x);
            var yMax = Mathf.Max(_selectionStartCanvas.y, currentCanvas.y);
            _selectionRect.style.left = xMin;
            _selectionRect.style.top = yMin;
            _selectionRect.style.width = xMax - xMin;
            _selectionRect.style.height = yMax - yMin;
        }

        private void CompleteSelection(Vector2 panelPosition)
        {
            var selectionRect = Rect.MinMaxRect(
                Mathf.Min(_selectionStartPanel.x, panelPosition.x),
                Mathf.Min(_selectionStartPanel.y, panelPosition.y),
                Mathf.Max(_selectionStartPanel.x, panelPosition.x),
                Mathf.Max(_selectionStartPanel.y, panelPosition.y));
            var hasSelectionArea = selectionRect.width >= 4f && selectionRect.height >= 4f;
            _selectionRect.style.display = DisplayStyle.None;

            if (!hasSelectionArea)
            {
                _selectionAdditive = false;
                _selectionToggle = false;
                return;
            }

            foreach (var nodeView in _nodeViews.Values)
            {
                if (selectionRect.Overlaps(nodeView.worldBound, true))
                {
                    if (_selectionToggle)
                    {
                        ToggleSelection(nodeView);
                    }
                    else
                    {
                        AddToSelection(nodeView);
                    }
                }
            }

            _selectionAdditive = false;
            _selectionToggle = false;
        }

        private static NodeView FindNodeView(VisualElement target)
        {
            var element = target;

            while (element != null)
            {
                if (element is NodeView nodeView)
                {
                    return nodeView;
                }

                element = element.parent;
            }

            return null;
        }

        private GraphEdgeView FindEdgeAt(Vector2 panelPosition)
        {
            var localPosition = _edgeLayer.WorldToLocal(panelPosition);
            for (var index = _edgeViews.Count - 1; index >= 0; index--)
            {
                if (_edgeViews[index].HitTest(localPosition, 12f))
                {
                    return _edgeViews[index];
                }
            }

            return null;
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (evt.button == 0)
            {
                var portView = FindPortView(evt.target as VisualElement);
                if (portView != null)
                {
                    ClearConnectionSelection();
                    _pendingPort = portView;
                    _connectionPointerId = evt.pointerId;
                    _connectionPointerPosition = evt.position;
                    PointerCaptureHelper.CapturePointer(this, evt.pointerId);
                    _viewModel.RequestStatus($"Connecting from {portView.ViewModel.DisplayName}...");
                    evt.StopPropagation();
                }
                else if (FindNodeView(evt.target as VisualElement) is { } nodeView)
                {
                    if (!IsInteractiveTarget(evt.target as VisualElement))
                    {
                        SelectNodeFromPointer(nodeView, evt);
                    }
                }
                else if (FindEdgeAt(evt.position) is { } edgeView)
                {
                    SelectConnection(edgeView.Connection);
                    Focus();
                    evt.StopPropagation();
                }
                else
                {
                    BeginSelection(evt.position, evt.pointerId, evt.shiftKey, evt.ctrlKey || evt.commandKey);
                    PointerCaptureHelper.CapturePointer(this, evt.pointerId);
                    evt.StopPropagation();
                }

                return;
            }

            if (evt.button != 2)
            {
                return;
            }

            _panning = true;
            _panPointerId = evt.pointerId;
            _panStartPointer = evt.position;
            _panStartPosition = _viewModel.ViewportPosition.Value;
            PointerCaptureHelper.CapturePointer(this, evt.pointerId);
            evt.StopPropagation();
        }

        public bool DeleteSelectedElements()
        {
            if (_selectedConnectionId.HasValue)
            {
                var selectedConnectionId = _selectedConnectionId.Value;
                var connection = _viewModel.Connections.FirstOrDefault(item => item.Id == selectedConnectionId);
                ClearConnectionSelection();
                if (connection == null)
                {
                    return false;
                }

                _viewModel.RequestDisconnect(connection.Id);
                return true;
            }

            if (_selectedNodes.Count == 0)
            {
                return false;
            }

            var nodeIds = _selectedNodes.Select(nodeView => nodeView.ViewModel.Model.Id).ToArray();
            ClearSelection();
            foreach (var nodeId in nodeIds)
            {
                _viewModel.RequestDeleteNode(nodeId);
            }

            return true;
        }

        public bool IsInteractiveTarget(VisualElement target)
        {
            var element = target;
            while (element != null && element != this)
            {
                if (element is PortView || element is Button || element is TextField || element is FloatField || element.ClassListContains("unity-base-field"))
                {
                    return true;
                }

                element = element.parent;
            }

            return false;
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (_connectionPointerId == evt.pointerId)
            {
                _connectionPointerPosition = evt.position;
                MarkCanvasDirty();
                evt.StopPropagation();
                return;
            }

            if (_selectionPointerId == evt.pointerId)
            {
                UpdateSelectionRectangle(evt.position);
                evt.StopPropagation();
                return;
            }

            if (!_panning || evt.pointerId != _panPointerId)
            {
                return;
            }

            var currentPointer = new Vector2(evt.position.x, evt.position.y);
            var delta = currentPointer - _panStartPointer;
            _viewModel.RequestViewport(_panStartPosition + delta, _viewModel.Zoom.Value);
            ApplyLayout();
            RefreshEdges();
            MarkCanvasDirty();
            evt.StopPropagation();
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (_connectionPointerId == evt.pointerId)
            {
                CompleteConnection(GetPortAt(evt.position));

                if (PointerCaptureHelper.HasPointerCapture(this, evt.pointerId))
                {
                    PointerCaptureHelper.ReleasePointer(this, evt.pointerId);
                }

                _connectionPointerId = -1;
                _connectionPointerPosition = Vector2.zero;
                MarkCanvasDirty();
                evt.StopPropagation();
                return;
            }

            if (_selectionPointerId == evt.pointerId)
            {
                CompleteSelection(evt.position);

                if (PointerCaptureHelper.HasPointerCapture(this, evt.pointerId))
                {
                    PointerCaptureHelper.ReleasePointer(this, evt.pointerId);
                }

                _selectionPointerId = -1;
                evt.StopPropagation();
                return;
            }

            if (!_panning || evt.pointerId != _panPointerId)
            {
                return;
            }
            _panning = false;
            _panPointerId = -1;

            if (PointerCaptureHelper.HasPointerCapture(this, evt.pointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, evt.pointerId);
            }

            evt.StopPropagation();
        }

        private void CompleteConnection(PortView portView)
        {
            var sourcePort = _pendingPort;
            _pendingPort = null;

            if (sourcePort == null || portView == null || sourcePort == portView)
            {
                _viewModel.RequestStatus("Connection cancelled.");
                return;
            }

            var first = sourcePort.ViewModel.Model;
            var second = portView.ViewModel.Model;
            var output = first.Direction == PortDirection.Output ? first : second;
            var input = first.Direction == PortDirection.Input ? first : second;

            if (output.Direction == PortDirection.Output && input.Direction == PortDirection.Input)
            {
                _viewModel.RequestConnect(output, input);
            }
            else
            {
                _viewModel.RequestStatus("A connection must go from Output to Input.");
            }
        }

        private PortView GetPortAt(Vector2 panelPosition)
        {
            return panel == null ? null : FindPortView(panel.Pick(panelPosition));
        }

        private static PortView FindPortView(VisualElement target)
        {
            var element = target;

            while (element != null)
            {
                if (element is PortView portView)
                {
                    return portView;
                }

                element = element.parent;
            }

            return null;
        }

        private void OnWheel(WheelEvent evt)
        {
            var factor = evt.delta.y > 0 ? 0.9f : 1.1f;
            var oldZoom = _viewModel.Zoom.Value;
            var newZoom = Mathf.Clamp(oldZoom * factor, 0.1f, 4f);
            var cursorPosition = _canvasRoot.WorldToLocal(evt.mousePosition);
            var currentPan = _viewModel.ViewportPosition.Value;
            var zoomRatio = newZoom / Mathf.Max(oldZoom, 0.0001f);
            var newPan = cursorPosition - (cursorPosition - currentPan) * zoomRatio;
            _viewModel.RequestViewport(newPan, newZoom);
            ApplyLayout();
            RefreshEdges();
            MarkCanvasDirty();
            evt.StopPropagation();
        }

        public bool TryGetGraphPosition(Vector2 panelPosition, out Vector2 graphPosition)
        {
            graphPosition = Vector2.zero;
            if (panel == null || !worldBound.Contains(panelPosition))
            {
                return false;
            }

            var canvasPosition = _canvasRoot.WorldToLocal(panelPosition);
            var zoom = Mathf.Max(_viewModel.Zoom.Value, 0.1f);
            graphPosition = (canvasPosition - _viewModel.ViewportPosition.Value) / zoom;
            return true;
        }

        public void Dispose()
        {
            _gridLayer.generateVisualContent -= OnGenerateGridContent;
            _connectionPreviewLayer.generateVisualContent -= OnGenerateConnectionPreview;

            if (_connectionPointerId >= 0 && PointerCaptureHelper.HasPointerCapture(this, _connectionPointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, _connectionPointerId);
            }

            if (_panPointerId >= 0 && PointerCaptureHelper.HasPointerCapture(this, _panPointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, _panPointerId);
            }

            if (_selectionPointerId >= 0 && PointerCaptureHelper.HasPointerCapture(this, _selectionPointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, _selectionPointerId);
            }

            _selectionRect.style.display = DisplayStyle.None;
            _selectionAdditive = false;
            _selectionToggle = false;
            _dragStartPositions.Clear();
            ClearSelection();
            ClearConnectionSelection();
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
