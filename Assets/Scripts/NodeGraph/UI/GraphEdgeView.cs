using System;
using NodeGraph.Core;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    internal static class GraphVisualColors
    {
        public static readonly Color Connection = new Color(0.7216f, 0.7373f, 0.7725f, 1f);
        public static readonly Color SelectedConnection = new Color(0.9804f, 0.8471f, 0.3765f, 1f);
    }

    public sealed class GraphEdgeView : VisualElement
    {
        private readonly Func<Guid, Vector2?> _portPositionProvider;
        private readonly Func<Guid, Rect?> _nodeBoundsProvider;
        private readonly Connection _connection;
        private bool _selected;

        public GraphEdgeView(Connection connection, Func<Guid, Vector2?> portPositionProvider, Func<Guid, Rect?> nodeBoundsProvider)
        {
            _connection = connection ?? throw new ArgumentNullException(nameof(connection));
            _portPositionProvider = portPositionProvider ?? throw new ArgumentNullException(nameof(portPositionProvider));
            _nodeBoundsProvider = nodeBoundsProvider ?? throw new ArgumentNullException(nameof(nodeBoundsProvider));
            pickingMode = PickingMode.Ignore;
            style.position = Position.Absolute;
            style.left = 0;
            style.top = 0;
            style.right = 0;
            style.bottom = 0;
            generateVisualContent += OnGenerateVisualContent;
        }

        public Connection Connection => _connection;

        public void Refresh()
        {
            MarkDirtyRepaint();
        }

        public void SetSelected(bool selected)
        {
            if (_selected == selected)
            {
                return;
            }

            _selected = selected;
            Refresh();
        }

        public bool HitTest(Vector2 point, float tolerance)
        {
            var outputPosition = _portPositionProvider(_connection.Output.Id);
            var inputPosition = _portPositionProvider(_connection.Input.Id);

            if (!outputPosition.HasValue || !inputPosition.HasValue)
            {
                return false;
            }

            var start = outputPosition.Value;
            var end = inputPosition.Value;
            var sourceBounds = _nodeBoundsProvider(_connection.OutputNode.Id);
            var targetBounds = _nodeBoundsProvider(_connection.InputNode.Id);

            if (sourceBounds.HasValue && targetBounds.HasValue && end.x < start.x)
            {
                const float margin = 16f;
                var routeY = FindRouteY(start, end, sourceBounds.Value, targetBounds.Value, margin);
                var startX = sourceBounds.Value.xMax + margin;
                var endX = targetBounds.Value.xMin - margin;
                var points = new[]
                {
                    start,
                    new Vector2(startX, start.y),
                    new Vector2(startX, routeY),
                    new Vector2(endX, routeY),
                    new Vector2(endX, end.y),
                    end
                };
                return HitTestPolyline(point, points, tolerance);
            }

            var tangent = Mathf.Max(36f, Mathf.Abs(end.x - start.x) * 0.45f);
            var firstControlPoint = start + new Vector2(tangent, 0);
            var secondControlPoint = end - new Vector2(tangent, 0);
            var previous = start;
            const int sampleCount = 32;

            for (var index = 1; index <= sampleCount; index++)
            {
                var t = index / (float)sampleCount;
                var current = EvaluateCubic(start, firstControlPoint, secondControlPoint, end, t);
                if (DistanceToSegment(point, previous, current) <= tolerance)
                {
                    return true;
                }

                previous = current;
            }

            return false;
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

            var painter = context.painter2D;
            painter.lineWidth = _selected ? 4f : 2.25f;
            painter.strokeColor = _selected ? GraphVisualColors.SelectedConnection : GraphVisualColors.Connection;
            painter.BeginPath();
            painter.MoveTo(start);
            var sourceBounds = _nodeBoundsProvider(_connection.OutputNode.Id);
            var targetBounds = _nodeBoundsProvider(_connection.InputNode.Id);
            if (sourceBounds.HasValue && targetBounds.HasValue && end.x < start.x)
            {
                DrawBackwardsCurve(painter, start, end, sourceBounds.Value, targetBounds.Value);
            }
            else
            {
                DrawDirectionalCurve(painter, start, end);
            }

            painter.Stroke();
        }

        private static void DrawDirectionalCurve(Painter2D painter, Vector2 start, Vector2 end)
        {
            var tangent = Mathf.Max(36f, Mathf.Abs(end.x - start.x) * 0.45f);
            painter.BezierCurveTo(
                start + new Vector2(tangent, 0),
                end - new Vector2(tangent, 0),
                end);
        }

        private static void DrawBackwardsCurve(Painter2D painter, Vector2 start, Vector2 end, Rect sourceBounds, Rect targetBounds)
        {
            const float margin = 16f;
            var routeY = FindRouteY(start, end, sourceBounds, targetBounds, margin);
            var startX = sourceBounds.xMax + margin;
            var endX = targetBounds.xMin - margin;
            var points = new[]
            {
                start,
                new Vector2(startX, start.y),
                new Vector2(startX, routeY),
                new Vector2(endX, routeY),
                new Vector2(endX, end.y),
                end
            };
            DrawRoundedPath(painter, points, 12f);
        }

        private static void DrawRoundedPath(Painter2D painter, Vector2[] points, float radius)
        {
            for (var index = 1; index < points.Length - 1; index++)
            {
                var incoming = points[index] - points[index - 1];
                var outgoing = points[index + 1] - points[index];
                var cornerRadius = Mathf.Min(radius, incoming.magnitude * 0.5f, outgoing.magnitude * 0.5f);
                var beforeCorner = points[index] - incoming.normalized * cornerRadius;
                var afterCorner = points[index] + outgoing.normalized * cornerRadius;
                painter.LineTo(beforeCorner);
                painter.QuadraticCurveTo(points[index], afterCorner);
            }

            painter.LineTo(points[points.Length - 1]);
        }

        private static float FindRouteY(Vector2 start, Vector2 end, Rect sourceBounds, Rect targetBounds, float margin)
        {
            var sourceBelowTarget = sourceBounds.center.y > targetBounds.center.y;
            var gapStart = sourceBelowTarget ? targetBounds.yMax + margin : sourceBounds.yMax + margin;
            var gapEnd = sourceBelowTarget ? sourceBounds.yMin - margin : targetBounds.yMin - margin;
            if (gapStart <= gapEnd)
            {
                return (gapStart + gapEnd) * 0.5f;
            }

            var routeBelow = Mathf.Max(sourceBounds.yMax, targetBounds.yMax) + margin;
            var routeAbove = Mathf.Min(sourceBounds.yMin, targetBounds.yMin) - margin;
            var belowDistance = Mathf.Abs(routeBelow - start.y) + Mathf.Abs(routeBelow - end.y);
            var aboveDistance = Mathf.Abs(routeAbove - start.y) + Mathf.Abs(routeAbove - end.y);
            return belowDistance <= aboveDistance ? routeBelow : routeAbove;
        }

        private static bool HitTestPolyline(Vector2 point, Vector2[] points, float tolerance)
        {
            for (var index = 1; index < points.Length; index++)
            {
                if (DistanceToSegment(point, points[index - 1], points[index]) <= tolerance)
                {
                    return true;
                }
            }

            return false;
        }

        private static Vector2 EvaluateCubic(Vector2 start, Vector2 firstControlPoint, Vector2 secondControlPoint, Vector2 end, float t)
        {
            var inverse = 1f - t;
            return inverse * inverse * inverse * start +
                   3f * inverse * inverse * t * firstControlPoint +
                   3f * inverse * t * t * secondControlPoint +
                   t * t * t * end;
        }

        private static float DistanceToSegment(Vector2 point, Vector2 start, Vector2 end)
        {
            var segment = end - start;
            var lengthSquared = segment.sqrMagnitude;
            if (lengthSquared <= 0.0001f)
            {
                return Vector2.Distance(point, start);
            }

            var projection = Mathf.Clamp01(Vector2.Dot(point - start, segment) / lengthSquared);
            return Vector2.Distance(point, start + segment * projection);
        }
    }
}
