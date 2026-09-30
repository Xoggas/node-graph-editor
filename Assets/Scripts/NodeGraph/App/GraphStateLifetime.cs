using System;
using Cysharp.Threading.Tasks;

namespace NodeGraph.App
{
    public sealed class GraphStateLifetime : VContainer.Unity.IStartable, IDisposable
    {
        private readonly GraphMutationState _graphMutationState;
        private readonly GraphDocumentState _graphDocumentState;
        private readonly SampleNodeState _sampleNodeState;
        private bool _started;

        public GraphStateLifetime(GraphMutationState graphMutationState, GraphDocumentState graphDocumentState, SampleNodeState sampleNodeState)
        {
            _graphMutationState = graphMutationState ?? throw new ArgumentNullException(nameof(graphMutationState));
            _graphDocumentState = graphDocumentState ?? throw new ArgumentNullException(nameof(graphDocumentState));
            _sampleNodeState = sampleNodeState ?? throw new ArgumentNullException(nameof(sampleNodeState));
        }

        public void Start()
        {
            if (_started)
            {
                return;
            }

            _started = true;
            _graphMutationState.EnterAsync().Forget();
            _graphDocumentState.EnterAsync().Forget();
            _sampleNodeState.EnterAsync().Forget();
        }

        public void Dispose()
        {
            if (!_started)
            {
                return;
            }

            _started = false;
            _sampleNodeState.ExitAsync().Forget();
            _graphDocumentState.ExitAsync().Forget();
            _graphMutationState.ExitAsync().Forget();
        }
    }
}
