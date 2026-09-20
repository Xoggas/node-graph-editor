using System;
using NodeGraph.Core;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public sealed class GraphEdgeView : VisualElement
    {
        private readonly Func<Guid, Vector2?> _portPositionProvider;
        private readonly Connection _connection;

        public GraphEdgeView(Connection connection, Func<Guid, Vector2?> portPositionProvider)
        {
            _connection = connection ?? throw new ArgumentNullException(nameof(connection));
            _portPositionProvider = portPositionProvider ?? throw new ArgumentNullException(nameof(portPositionProvider));
            pickingMode = PickingMode.Ignore;
            style.position = Position.Absolute;
            style.left = 0;
            style.top = 0;
            style.right = 0;
            style.bottom = 0;
            generateVisualContent += OnGenerateVisualContent;
        }

        public void Refresh()
        {
            MarkDirtyRepaint();
        }

        private void OnGenerateVisualContent(MeshGenerationContext context)
        {
            var outputPosition = _portPositionProvider(_connection.Output.Id);
            var inputPosition = _portPositionProvider(_connection.Input.Id);

            if (!outputPosition.HasValue || !inputPosition.HasValue)
            {
                return;
            }

            var start = outputPosition.Value;
            var end = inputPosition.Value;
            var direction = Mathf.Sign(end.x - start.x);
            var tangent = Mathf.Max(36f, Mathf.Abs(end.x - start.x) * 0.45f);

            var painter = context.painter2D;
            painter.lineWidth = 2.5f;
            painter.strokeColor = new Color(0.72f, 0.78f, 0.9f, 0.95f);
            painter.BeginPath();
            painter.MoveTo(start);
            painter.BezierCurveTo(
                start + new Vector2(tangent * direction, 0),
                end - new Vector2(tangent * direction, 0),
                end);
            painter.Stroke();
        }
    }
}
