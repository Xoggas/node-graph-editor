using System;
using NodeGraph.Core;
using NodeGraph.Flow;

namespace NodeGraph.App
{
    public sealed class GraphDocumentState : State
    {
        private readonly GraphSession _session;
        private readonly NodeGraphRegistry _registry;

        public GraphDocumentState(GraphSession session, NodeGraphRegistry registry)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
            _registry = registry ?? throw new ArgumentNullException(nameof(registry));
        }

        protected override void Subscribe()
        {
            Subscribe<NewGraphRequested>(OnNewGraphRequested);
            Subscribe<ReplaceGraphRequested>(OnReplaceGraphRequested);
            Subscribe<SaveCompletedRequested>(OnSaveCompletedRequested);
            Subscribe<StatusRequested>(OnStatusRequested);
        }

        private void OnNewGraphRequested(NewGraphRequested request)
        {
            ReplaceGraph(new GraphModel(_registry), string.Empty, "New graph.");
        }

        private void OnReplaceGraphRequested(ReplaceGraphRequested request)
        {
            if (request.Graph == null)
            {
                PublishStatus("The loaded graph is empty.");
                return;
            }

            ReplaceGraph(request.Graph, request.FilePath, request.Status);
        }

        private void OnSaveCompletedRequested(SaveCompletedRequested request)
        {
            Invoke(new FilePathChangedEvent(request.FilePath));
            Invoke(new GraphSavedEvent(request.FilePath));
            PublishStatus($"Saved: {request.FilePath}");
        }

        private void OnStatusRequested(StatusRequested request)
        {
            PublishStatus(request.Message);
        }

        private void ReplaceGraph(GraphModel graph, string filePath, string status)
        {
            _session.Replace(graph);
            Invoke(new GraphReplacedEvent());
            Invoke(new FilePathChangedEvent(filePath));
            PublishStatus(status);
        }

        private void PublishStatus(string message)
        {
            Invoke(new StatusChangedEvent(message ?? string.Empty));
        }
    }
}
