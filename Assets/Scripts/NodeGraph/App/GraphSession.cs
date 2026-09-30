using System;
using NodeGraph.Core;

namespace NodeGraph.App
{
    public sealed class GraphSession : IDisposable
    {
        public GraphModel Graph { get; private set; }

        public GraphSession(GraphModel graph)
        {
            Graph = graph ?? throw new ArgumentNullException(nameof(graph));
        }

        internal void Replace(GraphModel graph)
        {
            if (graph == null)
            {
                throw new ArgumentNullException(nameof(graph));
            }

            var previousGraph = Graph;
            Graph = graph;
            previousGraph?.Dispose();
        }

        public void Dispose()
        {
            Graph?.Dispose();
            Graph = null;
        }
    }
}
