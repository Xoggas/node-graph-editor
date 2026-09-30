using System;
using System.Collections.Generic;
using System.Linq;
using Cysharp.Threading.Tasks;
using R3;
using NodeGraph.App;
using NodeGraph.Core;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public sealed class GraphEditorView : VisualElement, IDisposable
    {
        private readonly GraphViewModel _viewModel;
        private readonly GraphEditorController _controller;
        private readonly GraphCanvas _canvas;
        private readonly VisualElement _palette;
        private readonly Label _statusLabel;
        private readonly Label _dragGhost;
        private readonly List<NodePaletteItem> _paletteItems = new List<NodePaletteItem>();
        private readonly CompositeDisposable _subscriptions = new CompositeDisposable();

        public GraphEditorView(GraphViewModel viewModel, GraphEditorController controller, NodeTypeRegistry nodeRegistry, NodeViewRegistry viewRegistry)
        {
            _viewModel = viewModel ?? throw new ArgumentNullException(nameof(viewModel));
            _controller = controller ?? throw new ArgumentNullException(nameof(controller));
            if (nodeRegistry == null)
            {
                throw new ArgumentNullException(nameof(nodeRegistry));
            }
            if (viewRegistry == null)
            {
                throw new ArgumentNullException(nameof(viewRegistry));
            }

            AddToClassList("node-graph-editor");

            style.flexGrow = 1;
            var template = Resources.Load<VisualTreeAsset>("NodeGraph/GraphEditor");
            if (template == null)
            {
                throw new InvalidOperationException("Missing graph editor UXML at Resources/NodeGraph/GraphEditor.uxml.");
            }
            template.CloneTree(this);

            var editorStyle = Resources.Load<StyleSheet>("NodeGraph/GraphEditor");
            if (editorStyle != null)
            {
                styleSheets.Add(editorStyle);
            }

            var newButton = this.Q<Button>("new-button");
            var openButton = this.Q<Button>("open-button");
            var saveButton = this.Q<Button>("save-button");
            _palette = this.Q<VisualElement>("node-palette");
            _statusLabel = this.Q<Label>("status-label");
            _dragGhost = this.Q<Label>("node-palette-drag-ghost");
            var canvasHost = this.Q<VisualElement>("canvas-host");
            if (newButton == null || openButton == null || saveButton == null || _palette == null ||
                _statusLabel == null || _dragGhost == null || canvasHost == null)
            {
                throw new InvalidOperationException("GraphEditor.uxml does not contain the required named elements.");
            }

            newButton.clicked += _controller.NewGraph;
            openButton.clicked += () => _controller.OpenAsync().Forget();
            saveButton.clicked += () => _controller.SaveAsync().Forget();

            foreach (var descriptor in nodeRegistry.Descriptors.Values.OrderBy(x => x.MenuPath).ThenBy(x => x.DisplayName))
            {
                var paletteItem = new NodePaletteItem(descriptor.TypeId, descriptor.DisplayName, descriptor.MenuPath);
                paletteItem.DragStarted += OnPaletteItemDragStarted;
                paletteItem.DragMoved += OnPaletteItemDragMoved;
                paletteItem.DragEnded += OnPaletteItemDragEnded;
                _paletteItems.Add(paletteItem);
                _palette.Add(paletteItem);
            }

            _canvas = new GraphCanvas(viewModel, viewRegistry);
            canvasHost.Add(_canvas);
            RegisterCallback<KeyDownEvent>(OnKeyDown, TrickleDown.TrickleDown);
            _dragGhost.pickingMode = PickingMode.Ignore;
            _dragGhost.style.display = DisplayStyle.None;

            _subscriptions.Add(_viewModel.Status.Subscribe(UpdateStatus));
            _subscriptions.Add(_viewModel.IsDirty.Subscribe(_ => UpdateStatus(_viewModel.Status.Value)));
            UpdateStatus(_viewModel.Status.Value);
        }

        private void UpdateStatus(string status)
        {
            var dirtyMarker = _viewModel.IsDirty.Value ? " *" : string.Empty;
            _statusLabel.text = $"{status}{dirtyMarker}";
        }

        private void OnPaletteItemDragStarted(NodePaletteItem item, PointerDownEvent evt)
        {
            _dragGhost.text = item.DisplayName;
            _dragGhost.style.display = DisplayStyle.Flex;
            _dragGhost.BringToFront();
            UpdateDragGhostPosition(evt.position);
        }

        private void OnPaletteItemDragMoved(NodePaletteItem item, PointerMoveEvent evt)
        {
            UpdateDragGhostPosition(evt.position);
        }

        private void OnPaletteItemDragEnded(NodePaletteItem item, PointerUpEvent evt)
        {
            if (_canvas.TryGetGraphPosition(evt.position, out var graphPosition))
            {
                var nodeHalfSize = new Vector2(110f, 48f);
                _controller.AddNode(item.TypeId, graphPosition - nodeHalfSize);
            }

            _dragGhost.style.display = DisplayStyle.None;
            _dragGhost.text = string.Empty;
        }

        private void UpdateDragGhostPosition(Vector2 panelPosition)
        {
            var localPosition = this.WorldToLocal(panelPosition);
            var ghostWidth = Mathf.Max(_dragGhost.layout.width, 170f);
            var ghostHeight = Mathf.Max(_dragGhost.layout.height, 34f);
            _dragGhost.style.left = localPosition.x - ghostWidth * 0.5f;
            _dragGhost.style.top = localPosition.y - ghostHeight * 0.5f;
        }

        private void OnKeyDown(KeyDownEvent evt)
        {
            if (evt.keyCode != KeyCode.Delete && evt.keyCode != KeyCode.Backspace)
            {
                return;
            }

            if (_canvas.IsInteractiveTarget(evt.target as VisualElement))
            {
                return;
            }

            if (_canvas.DeleteSelectedElements())
            {
                evt.StopPropagation();
            }
        }

        public void Dispose()
        {
            foreach (var paletteItem in _paletteItems)
            {
                paletteItem.DragStarted -= OnPaletteItemDragStarted;
                paletteItem.DragMoved -= OnPaletteItemDragMoved;
                paletteItem.DragEnded -= OnPaletteItemDragEnded;
                paletteItem.Dispose();
            }
            _paletteItems.Clear();
            _subscriptions.Dispose();
            _canvas.Dispose();
        }
    }
}
