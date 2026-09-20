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

        private readonly VisualElement _templateRoot;
        private readonly CompositeDisposable _bindings = new CompositeDisposable();
        private bool _dragging;
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
        public event Action<NodeView> Selected;
        public event Action<NodeView> DeleteRequested;
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

            AddResourceStyleSheet("NodeGraph/NodeView");
            LoadCustomBody();
            Title.text = ViewModel.DisplayName;
            RebuildPorts();

            RegisterCallback<PointerDownEvent>(OnPointerDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove);
            RegisterCallback<PointerUpEvent>(OnPointerUp);
            RegisterCallback<KeyDownEvent>(OnKeyDown);
            RegisterCallback<GeometryChangedEvent>(_ => parent?.MarkDirtyRepaint());
            focusable = true;
        }

        public IReadOnlyList<PortView> PortViews => Children()
            .SelectMany(x => x.Query<PortView>().ToList())
            .ToArray();

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
            if (styleSheet != null && !styleSheets.Contains(styleSheet))
            {
                styleSheets.Add(styleSheet);
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

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (evt.button != 0)
            {
                return;
            }

            Focus();
            Selected?.Invoke(this);
            _dragging = true;
            _dragStartPointer = evt.position;
            _dragStartPosition = ViewModel.Position.Value;
            DragStarted?.Invoke(this, evt);
            evt.StopPropagation();
        }

        private void OnPointerMove(PointerMoveEvent evt)
        {
            if (!_dragging)
            {
                return;
            }
            DragMoved?.Invoke(this, evt);
            evt.StopPropagation();
        }

        private void OnPointerUp(PointerUpEvent evt)
        {
            if (!_dragging)
            {
                return;
            }
            _dragging = false;
            DragEnded?.Invoke(this, evt);
            evt.StopPropagation();
        }

        public Vector2 GetDragPosition(Vector2 pointerPosition, float zoom)
        {
            var delta = (pointerPosition - _dragStartPointer) / Mathf.Max(zoom, 0.01f);
            return _dragStartPosition + delta;
        }

        private void OnKeyDown(KeyDownEvent evt)
        {
            if (evt.keyCode == KeyCode.Delete || evt.keyCode == KeyCode.Backspace)
            {
                DeleteRequested?.Invoke(this);
                evt.StopPropagation();
            }
        }

        public virtual void Dispose()
        {
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

        public PortViewModel ViewModel { get; }
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

            var label = this.Q<Label>("port-label");
            var dot = this.Q<VisualElement>("port-dot");
            if (label == null || dot == null)
            {
                throw new InvalidOperationException("PortView.uxml does not contain port-label and port-dot.");
            }

            var styleSheet = Resources.Load<StyleSheet>("NodeGraph/PortView");
            if (styleSheet != null)
            {
                styleSheets.Add(styleSheet);
            }

            AddToClassList(ViewModel.Direction == PortDirection.Input ? "input-port" : "output-port");
            label.text = ViewModel.DisplayName;
            dot.AddToClassList(ViewModel.Direction == PortDirection.Input ? "input-dot" : "output-dot");

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
