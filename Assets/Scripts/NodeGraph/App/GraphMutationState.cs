using System;
using NodeGraph.Core;
using NodeGraph.Flow;

namespace NodeGraph.App
{
    public sealed class GraphMutationState : State
    {
        private readonly IGraphMutationService _mutationService;

        public GraphMutationState(IGraphMutationService mutationService)
        {
            _mutationService = mutationService ?? throw new ArgumentNullException(nameof(mutationService));
        }

        protected override void Subscribe()
        {
            Subscribe<CreateNodeRequested>(OnCreateNodeRequested);
            Subscribe<DeleteNodeRequested>(OnDeleteNodeRequested);
            Subscribe<ConnectPortsRequested>(OnConnectPortsRequested);
            Subscribe<DisconnectConnectionRequested>(OnDisconnectConnectionRequested);
            Subscribe<MoveNodeRequested>(OnMoveNodeRequested);
            Subscribe<SetViewportRequested>(OnSetViewportRequested);
        }

        private void OnCreateNodeRequested(CreateNodeRequested request)
        {
            try
            {
                _mutationService.AddNode(request.TypeId, request.Position);
                PublishStatus($"Added {request.TypeId}.");
            }
            catch (Exception exception)
            {
                PublishStatus(exception.Message);
            }
        }

        private void OnDeleteNodeRequested(DeleteNodeRequested request)
        {
            try
            {
                if (!_mutationService.DeleteNode(request.NodeId))
                {
                    PublishStatus("The node could not be deleted.");
                }
            }
            catch (Exception exception)
            {
                PublishStatus(exception.Message);
            }
        }

        private void OnConnectPortsRequested(ConnectPortsRequested request)
        {
            try
            {
                var result = _mutationService.Connect(request.OutputPortId, request.InputPortId);
                PublishStatus(result.Success ? "Connected." : result.Message);
            }
            catch (Exception exception)
            {
                PublishStatus(exception.Message);
            }
        }

        private void OnDisconnectConnectionRequested(DisconnectConnectionRequested request)
        {
            try
            {
                PublishStatus(_mutationService.Disconnect(request.ConnectionId)
                    ? "Connection deleted."
                    : "The connection was not found.");
            }
            catch (Exception exception)
            {
                PublishStatus(exception.Message);
            }
        }

        private void OnMoveNodeRequested(MoveNodeRequested request)
        {
            if (!_mutationService.MoveNode(request.NodeId, request.Position))
            {
                return;
            }
        }

        private void OnSetViewportRequested(SetViewportRequested request)
        {
            _mutationService.SetViewport(request.Position, request.Zoom);
        }

        private void PublishStatus(string message)
        {
            Invoke(new StatusChangedEvent(message ?? string.Empty));
        }
    }
}
