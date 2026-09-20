using System;
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
            var canvasHost = this.Q<VisualElement>("canvas-host");
            if (newButton == null || openButton == null || saveButton == null || _palette == null ||
                _statusLabel == null || canvasHost == null)
            {
                throw new InvalidOperationException("GraphEditor.uxml does not contain the required named elements.");
            }

            newButton.clicked += _controller.NewGraph;
            openButton.clicked += () => _controller.OpenAsync().Forget();
            saveButton.clicked += () => _controller.SaveAsync().Forget();

            foreach (var descriptor in nodeRegistry.Descriptors.Values.OrderBy(x => x.MenuPath).ThenBy(x => x.DisplayName))
            {
                var capturedTypeId = descriptor.TypeId;
                _palette.Add(new Button(() => _controller.AddNode(capturedTypeId))
                {
                    text = $"+ {descriptor.DisplayName}"
                });
            }

            _canvas = new GraphCanvas(viewModel, viewRegistry);
            canvasHost.Add(_canvas);

            _subscriptions.Add(_viewModel.Status.Subscribe(UpdateStatus));
            _subscriptions.Add(_viewModel.IsDirty.Subscribe(_ => UpdateStatus(_viewModel.Status.Value)));
            UpdateStatus(_viewModel.Status.Value);
        }

        private void UpdateStatus(string status)
        {
            var dirtyMarker = _viewModel.IsDirty.Value ? " *" : string.Empty;
            _statusLabel.text = $"{status}{dirtyMarker}";
        }

        public void Dispose()
        {
            _subscriptions.Dispose();
            _canvas.Dispose();
        }
    }
}
