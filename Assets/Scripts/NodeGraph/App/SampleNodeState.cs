using System;
using NodeGraph.Flow;
namespace NodeGraph.App
{
    public sealed class SampleNodeState : State
    {
        private readonly ISampleNodeMutationService _mutationService;

        public SampleNodeState(ISampleNodeMutationService mutationService)
        {
            _mutationService = mutationService ?? throw new ArgumentNullException(nameof(mutationService));
        }

        protected override void Subscribe()
        {
            Subscribe<SetNumberValueRequested>(OnSetNumberValueRequested);
            Subscribe<AddDynamicOutputRequested>(OnAddDynamicOutputRequested);
        }

        private void OnSetNumberValueRequested(SetNumberValueRequested request)
        {
            _mutationService.SetNumberValue(request.NodeId, request.Value);
        }

        private void OnAddDynamicOutputRequested(AddDynamicOutputRequested request)
        {
            _mutationService.AddDynamicOutput(request.NodeId);
        }
    }
}
