using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NodeGraph.Core;
using R3;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public abstract class NodeView : VisualElement, IDisposable
    {
        private const string TemplatePath = "NodeGraph/NodeView";
        private static readonly Color NodeBackgroundColor = new Color(0.2f, 0.2078f, 0.2314f, 1f);
        private static readonly Color HeaderBackgroundColor = new Color(0.2706f, 0.2824f, 0.3098f, 1f);
        private static readonly Color PortsBackgroundColor = new Color(0.1686f, 0.1765f, 0.1961f, 1f);
        private static readonly Color BorderColor = new Color(0.3882f, 0.4039f, 0.4392f, 1f);
        private static readonly Color SelectedBorderColor = new Color(0.8627f, 0.8745f, 0.8941f, 1f);
        private static readonly Color PrimaryTextColor = new Color(0.9608f, 0.9647f, 0.9725f, 1f);
        private static readonly Color SecondaryTextColor = new Color(0.8118f, 0.8235f, 0.8471f, 1f);

        private readonly VisualElement _templateRoot;
        private readonly CompositeDisposable _bindings = new CompositeDisposable();
        private bool _dragging;
        private int _dragPointerId = -1;
        private Vector2 _dragStartPointer;
        private Vector2 _dragStartPosition;

        public NodeViewModel ViewModel { get; }
        protected VisualElement Body { get; }
        protected VisualElement InputPorts { get; }
        protected VisualElement OutputPorts { get; }
        protected Label Title { get; }
        protected VisualElement TemplateRoot => _templateRoot;
        protected CompositeDisposable Bindings => _bindings;

        public event Action<NodeView, PointerDownEvent> DragStarted;
        public event Action<NodeView, PointerMoveEvent> DragMoved;
        public event Action<NodeView, PointerUpEvent> DragEnded;
        public event Action<NodeView> LayoutChanged;
        public event Action<PortView> ConnectionRequested;
        public event Action<PortView> ConnectionReleased;

        protected NodeView(NodeViewModel viewModel)
        {
            ViewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            AddToClassList("node-graph-node");
            style.position = Position.Absolute;
            style.flexShrink = 0;

            var template = Resources.Load<VisualTreeAsset>(TemplatePath);
            if (template == null)
            {
                throw new InvalidOperationException($"Missing node view UXML at Resources/{TemplatePath}.uxml.");
            }
            template.CloneTree(this);

            _templateRoot = this.Q<VisualElement>("node-root");
            Title = this.Q<Label>("node-title");
            Body = this.Q<VisualElement>("node-body");
            InputPorts = this.Q<VisualElement>("input-ports");
            OutputPorts = this.Q<VisualElement>("output-ports");
            if (_templateRoot == null || Title == null || Body == null || InputPorts == null || OutputPorts == null)
            {
                throw new InvalidOperationException("NodeView.uxml does not contain the required named elements.");
            }

            _templateRoot.AddToClassList("node-graph-node");
            AddResourceStyleSheet("NodeGraph/NodeView");
            LoadCustomBody();
            ApplyVisualStyle();
            Title.text = ViewModel.DisplayName;
            RebuildPorts();

            RegisterCallback<PointerDownEvent>(OnPointerDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove);
            RegisterCallback<PointerUpEvent>(OnPointerUp);
            RegisterCallback<GeometryChangedEvent>(OnGeometryChanged);
            focusable = true;
        }

        public IReadOnlyList<PortView> PortViews => Children()
            .SelectMany(x => x.Query<PortView>().ToList())
            .ToArray();

        public void SetSelected(bool selected)
        {
            if (selected)
            {
                AddToClassList("selected");
                _templateRoot.AddToClassList("selected");
                SetBorderColor(_templateRoot, SelectedBorderColor);
            }
            else
            {
                RemoveFromClassList("selected");
                _templateRoot.RemoveFromClassList("selected");
                SetBorderColor(_templateRoot, BorderColor);
            }
        }

        private void ApplyVisualStyle()
        {
            style.minWidth = 220f;
            style.minHeight = 96f;
            style.flexShrink = 0f;
            style.backgroundColor = Color.clear;
            style.borderTopWidth = 0f;
            style.borderRightWidth = 0f;
            style.borderBottomWidth = 0f;
            style.borderLeftWidth = 0f;
            style.borderTopLeftRadius = 0f;
            style.borderTopRightRadius = 0f;
            style.borderBottomLeftRadius = 0f;
            style.borderBottomRightRadius = 0f;

            _templateRoot.style.flexGrow = 1f;
            _templateRoot.style.minHeight = 96f;
            _templateRoot.style.backgroundColor = NodeBackgroundColor;
            _templateRoot.style.borderTopWidth = 1f;
            _templateRoot.style.borderRightWidth = 1f;
            _templateRoot.style.borderBottomWidth = 1f;
            _templateRoot.style.borderLeftWidth = 1f;
            _templateRoot.style.borderTopLeftRadius = 6f;
            _templateRoot.style.borderTopRightRadius = 6f;
            _templateRoot.style.borderBottomLeftRadius = 6f;
            _templateRoot.style.borderBottomRightRadius = 6f;
            _templateRoot.style.overflow = Overflow.Hidden;
            SetBorderColor(_templateRoot, BorderColor);

            var header = this.Q<VisualElement>("node-header");
            header.style.height = 34f;
            header.style.flexShrink = 0f;
            header.style.paddingLeft = 10f;
            header.style.paddingRight = 10f;
            header.style.backgroundColor = HeaderBackgroundColor;
            header.style.borderTopLeftRadius = 5f;
            header.style.borderTopRightRadius = 5f;

            var ports = this.Q<VisualElement>("node-ports");
            ports.style.minHeight = 29f;
            ports.style.paddingLeft = 7f;
            ports.style.paddingRight = 7f;
            ports.style.paddingTop = 3f;
            ports.style.paddingBottom = 3f;
            ports.style.backgroundColor = PortsBackgroundColor;

            Body.style.minHeight = 34f;
            Body.style.paddingLeft = 10f;
            Body.style.paddingRight = 10f;
            Body.style.paddingTop = 8f;
            Body.style.paddingBottom = 8f;
            Body.style.backgroundColor = NodeBackgroundColor;
            Body.style.borderBottomLeftRadius = 5f;
            Body.style.borderBottomRightRadius = 5f;

            Title.style.color = PrimaryTextColor;
            Title.style.fontSize = 13f;

            foreach (var label in Body.Query<Label>().ToList())
            {
                label.style.color = SecondaryTextColor;
            }
        }

        private static void SetBorderColor(VisualElement element, Color color)
        {
            element.style.borderTopColor = color;
            element.style.borderRightColor = color;
            element.style.borderBottomColor = color;
            element.style.borderLeftColor = color;
        }

        public void ApplyGraphPosition(Vector2 position, float zoom, Vector2 pan)
        {
            style.left = position.x * zoom + pan.x;
            style.top = position.y * zoom + pan.y;
            style.scale = new Scale(Vector3.one * zoom);
            style.transformOrigin = new TransformOrigin(0, 0, 0);
        }

        public void RebuildPorts()
        {
            InputPorts.Clear();
            OutputPorts.Clear();
            foreach (var port in ViewModel.Ports)
            {
                var portView = new PortView(port);
                portView.ConnectionRequested += OnConnectionRequested;
                portView.ConnectionReleased += OnConnectionReleased;
                if (port.Direction == PortDirection.Input)
                {
                    InputPorts.Add(portView);
                }
                else
                {
                    OutputPorts.Add(portView);
                }
            }
        }

        protected void AddResourceStyleSheet(string path)
        {
            var styleSheet = Resources.Load<StyleSheet>(path);

            if (styleSheet == null)
            {
                return;
            }

            if (!styleSheets.Contains(styleSheet))
            {
                styleSheets.Add(styleSheet);
            }

            if (_templateRoot != null && !_templateRoot.styleSheets.Contains(styleSheet))
            {
                _templateRoot.styleSheets.Add(styleSheet);
            }
        }

        private void LoadCustomBody()
        {
            var attribute = GetType().GetCustomAttribute<NodeViewForAttribute>();
            if (attribute == null)
            {
                return;
            }

            if (!string.IsNullOrWhiteSpace(attribute.UssPath))
            {
                AddResourceStyleSheet(attribute.UssPath);
            }

            if (string.IsNullOrWhiteSpace(attribute.UxmlPath))
            {
                var conventionPath = $"NodeGraph/Views/{GetType().Name}";
                if (Resources.Load<VisualTreeAsset>(conventionPath) != null)
                {
                    LoadBodyTemplate(conventionPath);
                }
                return;
            }

            LoadBodyTemplate(attribute.UxmlPath);
        }

        protected void LoadBodyTemplate(string path)
        {
            var bodyTemplate = Resources.Load<VisualTreeAsset>(path);
            if (bodyTemplate == null)
            {
                throw new InvalidOperationException(
                    $"Missing node view UXML at Resources/{path}.uxml for '{GetType().FullName}'.");
            }
            bodyTemplate.CloneTree(Body);
        }

        private void OnConnectionRequested(PortView portView)
        {
            ConnectionRequested?.Invoke(portView);
        }

        private void OnConnectionReleased(PortView portView)
        {
            ConnectionReleased?.Invoke(portView);
        }

        private void OnGeometryChanged(GeometryChangedEvent evt)
        {
            LayoutChanged?.Invoke(this);
            parent?.MarkDirtyRepaint();
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (evt.button != 0 || IsInteractiveTarget(evt.target as VisualElement))
            {
                return;
            }

            Focus();
            _dragging = true;
            _dragPointerId = evt.pointerId;
            _dragStartPointer = evt.position;
            _dragStartPosition = ViewModel.Position.Value;
            PointerCaptureHelper.CapturePointer(this, evt.pointerId);
            DragStarted?.Invoke(this, evt);
            evt.StopPropagation();
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (!_dragging || evt.pointerId != _dragPointerId)
            {
                return;
            }
            DragMoved?.Invoke(this, evt);
            evt.StopPropagation();
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (!_dragging || evt.pointerId != _dragPointerId)
            {
                return;
            }
            _dragging = false;

            if (PointerCaptureHelper.HasPointerCapture(this, evt.pointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, evt.pointerId);
            }

            _dragPointerId = -1;
            DragEnded?.Invoke(this, evt);
            evt.StopPropagation();
        }

        private static bool IsInteractiveTarget(VisualElement target)
        {
            var element = target;

            while (element != null)
            {
                if (element is PortView || element is Button || element is TextField || element is FloatField || element.ClassListContains("unity-base-field"))
                {
                    return true;
                }

                element = element.parent;
            }

            return false;
        }

        public Vector2 GetDragPosition(Vector2 pointerPosition, float zoom)
        {
            var delta = (pointerPosition - _dragStartPointer) / Mathf.Max(zoom, 0.01f);
            return _dragStartPosition + delta;
        }

        public virtual void Dispose()
        {
            if (_dragPointerId >= 0 && PointerCaptureHelper.HasPointerCapture(this, _dragPointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, _dragPointerId);
            }

            _bindings.Dispose();
            foreach (var portView in PortViews)
            {
                portView.Dispose();
            }
        }
    }

    public sealed class PortView : VisualElement, IDisposable
    {
        private const string TemplatePath = "NodeGraph/PortView";
        private readonly VisualElement _connectionDot;

        public PortViewModel ViewModel { get; }
        public Vector2 WorldConnectionPoint => _connectionDot.worldBound.center;
        public event Action<PortView> ConnectionRequested;
        public event Action<PortView> ConnectionReleased;

        public PortView(PortViewModel viewModel)
        {
            ViewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            var template = Resources.Load<VisualTreeAsset>(TemplatePath);
            if (template == null)
            {
                throw new InvalidOperationException($"Missing port view UXML at Resources/{TemplatePath}.uxml.");
            }
            template.CloneTree(this);

            var portRoot = this.Q<VisualElement>("port-root");
            var label = this.Q<Label>("port-label");
            _connectionDot = this.Q<VisualElement>("port-dot");

            if (portRoot == null || label == null || _connectionDot == null)
            {
                throw new InvalidOperationException("PortView.uxml does not contain port-label and port-dot.");
            }

            var styleSheet = Resources.Load<StyleSheet>("NodeGraph/PortView");

            if (styleSheet != null)
            {
                if (!styleSheets.Contains(styleSheet))
                {
                    styleSheets.Add(styleSheet);
                }

                if (!portRoot.styleSheets.Contains(styleSheet))
                {
                    portRoot.styleSheets.Add(styleSheet);
                }
            }

            var directionClass = ViewModel.Direction == PortDirection.Input ? "input-port" : "output-port";
            AddToClassList(directionClass);
            portRoot.AddToClassList(directionClass);

            portRoot.style.height = 23f;
            portRoot.style.minWidth = 94f;
            portRoot.style.flexDirection = ViewModel.Direction == PortDirection.Input
                ? FlexDirection.Row
                : FlexDirection.RowReverse;
            portRoot.style.alignItems = Align.Center;
            portRoot.style.paddingLeft = 2f;
            portRoot.style.paddingRight = 2f;

            _connectionDot.style.width = 10f;
            _connectionDot.style.height = 10f;
            _connectionDot.style.flexShrink = 0f;
            _connectionDot.style.borderTopLeftRadius = 5f;
            _connectionDot.style.borderTopRightRadius = 5f;
            _connectionDot.style.borderBottomLeftRadius = 5f;
            _connectionDot.style.borderBottomRightRadius = 5f;
            _connectionDot.style.backgroundColor = GraphVisualColors.Connection;
            _connectionDot.style.borderTopColor = GraphVisualColors.Connection;
            _connectionDot.style.borderRightColor = GraphVisualColors.Connection;
            _connectionDot.style.borderBottomColor = GraphVisualColors.Connection;
            _connectionDot.style.borderLeftColor = GraphVisualColors.Connection;

            if (ViewModel.Direction == PortDirection.Input)
            {
                _connectionDot.style.marginRight = 6f;
            }
            else
            {
                _connectionDot.style.marginLeft = 6f;
            }

            label.style.color = new Color(0.8392f, 0.851f, 0.8706f, 1f);
            label.style.fontSize = 12f;
            label.style.height = 18f;
            label.style.minHeight = 18f;
            label.style.alignSelf = Align.Center;
            label.style.unityTextAlign = TextAnchor.MiddleLeft;
            label.text = ViewModel.DisplayName;
            _connectionDot.AddToClassList(ViewModel.Direction == PortDirection.Input ? "input-dot" : "output-dot");

            RegisterCallback<PointerDownEvent>(evt =>
            {
                if (evt.button == 0)
                {
                    ConnectionRequested?.Invoke(this);
                    evt.StopPropagation();
                }
            });
            RegisterCallback<PointerUpEvent>(evt =>
            {
                if (evt.button == 0)
                {
                    ConnectionReleased?.Invoke(this);
                    evt.StopPropagation();
                }
            });
        }

        public void Dispose()
        {
        }
    }
}
