using System;
using NodeGraph.Samples;

namespace NodeGraph.App
{
    public interface ISampleNodeMutationService
    {
        bool SetNumberValue(Guid nodeId, float value);
        bool AddDynamicOutput(Guid nodeId);
    }

    public sealed class SampleNodeMutationService : ISampleNodeMutationService
    {
        private readonly GraphSession _session;

        public SampleNodeMutationService(GraphSession session)
        {
            _session = session ?? throw new ArgumentNullException(nameof(session));
        }

        public bool SetNumberValue(Guid nodeId, float value)
        {
            if (!_session.Graph.TryGetNode(nodeId, out var node) || node is not NumberNode numberNode)
            {
                return false;
            }

            numberNode.SetValue(value);
            return true;
        }

        public bool AddDynamicOutput(Guid nodeId)
        {
            if (!_session.Graph.TryGetNode(nodeId, out var node) || node is not DynamicOutputNode dynamicOutputNode)
            {
                return false;
            }

            dynamicOutputNode.AddOutput();
            return true;
        }
    }
}
