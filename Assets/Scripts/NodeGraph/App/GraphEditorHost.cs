using System;
using NodeGraph.Core;
using NodeGraph.UI;
using UnityEngine;
using UnityEngine.UIElements;
using VContainer;

namespace NodeGraph.App
{
    [RequireComponent(typeof(UIDocument))]
    public sealed class GraphEditorHost : MonoBehaviour
    {
        private UIDocument _document;
        private GraphEditorView _view;

        private void Awake()
        {
            _document = GetComponent<UIDocument>();
        }

        [Inject]
        public void Construct(GraphViewModel viewModel, GraphEditorController controller, NodeTypeRegistry nodeRegistry, NodeViewRegistry viewRegistry)
        {
            if (_document == null)
            {
                _document = GetComponent<UIDocument>();
            }

            _view?.Dispose();
            _document.rootVisualElement.Clear();
            _view = new GraphEditorView(viewModel, controller, nodeRegistry, viewRegistry);
            _document.rootVisualElement.Add(_view);
        }

        private void OnDestroy()
        {
            _view?.Dispose();
        }
    }
}
