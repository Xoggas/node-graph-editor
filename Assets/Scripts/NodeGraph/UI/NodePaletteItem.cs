using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public sealed class NodePaletteItem : VisualElement, IDisposable
    {
        private const string TemplatePath = "NodeGraph/NodePaletteItem";
        private int _dragPointerId = -1;
        private bool _dragging;

        public string TypeId { get; }
        public string DisplayName { get; }

        public event Action<NodePaletteItem, PointerDownEvent> DragStarted;
        public event Action<NodePaletteItem, PointerMoveEvent> DragMoved;
        public event Action<NodePaletteItem, PointerUpEvent> DragEnded;

        public NodePaletteItem(string typeId, string displayName, string menuPath)
        {
            if (string.IsNullOrWhiteSpace(typeId))
            {
                throw new ArgumentException("A palette item type id is required.", nameof(typeId));
            }

            TypeId = typeId;
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? typeId : displayName;
            AddToClassList("node-palette-item");
            style.flexShrink = 0;

            var template = Resources.Load<VisualTreeAsset>(TemplatePath);
            if (template == null)
            {
                throw new InvalidOperationException($"Missing node palette item UXML at Resources/{TemplatePath}.uxml.");
            }

            template.CloneTree(this);
            var root = this.Q<VisualElement>("palette-item-root");
            var title = this.Q<Label>("palette-item-title");
            var type = this.Q<Label>("palette-item-type");
            if (root == null || title == null || type == null)
            {
                throw new InvalidOperationException("NodePaletteItem.uxml does not contain the required named elements.");
            }

            title.text = DisplayName;
            type.text = string.IsNullOrWhiteSpace(menuPath) ? typeId : menuPath;

            RegisterCallback<PointerDownEvent>(OnPointerDown);
            RegisterCallback<PointerMoveEvent>(OnPointerMove);
            RegisterCallback<PointerUpEvent>(OnPointerUp);
        }

        private void OnPointerDown(PointerDownEvent evt)
        {
            if (evt.button != 0)
            {
                return;
            }

            _dragging = true;
            _dragPointerId = evt.pointerId;
            AddToClassList("dragging");
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
            RemoveFromClassList("dragging");
            if (PointerCaptureHelper.HasPointerCapture(this, evt.pointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, evt.pointerId);
            }

            _dragPointerId = -1;
            DragEnded?.Invoke(this, evt);
            evt.StopPropagation();
        }

        public void Dispose()
        {
            if (_dragPointerId >= 0 && PointerCaptureHelper.HasPointerCapture(this, _dragPointerId))
            {
                PointerCaptureHelper.ReleasePointer(this, _dragPointerId);
            }

            _dragPointerId = -1;
            _dragging = false;
        }
    }
}
