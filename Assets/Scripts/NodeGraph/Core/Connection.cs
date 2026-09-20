using System;

namespace NodeGraph.Core
{
    public sealed class Connection
    {
        public Guid Id { get; }
        public Port Output { get; }
        public Port Input { get; }
        public NodeModel OutputNode => Output?.Owner;
        public NodeModel InputNode => Input?.Owner;

        public Connection(Guid id, Port output, Port input)
        {
            Id = id;
            Output = output;
            Input = input;
        }
    }
}
