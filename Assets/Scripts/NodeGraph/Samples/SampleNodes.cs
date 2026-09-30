using System;
using NodeGraph.Core;

namespace NodeGraph.Samples
{
    public sealed class NumberState
    {
        public float Value { get; set; }
    }

    [GraphNode("sample.number", "Number", "Samples")]
    public sealed class NumberNode : NodeModel<NumberState>
    {
        public NumberNode(Guid id) : base(id)
        {
        }

        public float Value { get; private set; }

        protected override void OnInitialize()
        {
            DefineOutput("value", typeof(float), "Value");
        }

        internal void SetValue(float value)
        {
            if (Math.Abs(Value - value) < 0.0001f)
            {
                return;
            }
            Value = value;
            RaiseChanged(NodeChangeKind.State);
        }

        protected override NumberState CaptureState()
        {
            return new NumberState { Value = Value };
        }

        protected override void RestoreState(NumberState state)
        {
            SetValue(state?.Value ?? 0f);
        }
    }

    public sealed class EmptyState
    {
    }

    [GraphNode("sample.sink", "Float Sink", "Samples")]
    public sealed class FloatSinkNode : NodeModel<EmptyState>
    {
        public FloatSinkNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineInput("value", typeof(float), "Value");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphDataType("sample.base-value")]
    public abstract class BaseValue
    {
    }

    [GraphDataType("sample.value-interface")]
    public interface IValue
    {
    }

    [GraphDataType("sample.derived-value")]
    public sealed class DerivedValue : BaseValue, IValue
    {
    }

    [GraphNode("sample.derived-source", "Derived Value", "Samples")]
    public sealed class DerivedValueSourceNode : NodeModel<EmptyState>
    {
        public DerivedValueSourceNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineOutput("value", typeof(DerivedValue), "Derived Value");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphNode("sample.base-sink", "Base Value Sink", "Samples")]
    public sealed class BaseValueSinkNode : NodeModel<EmptyState>
    {
        public BaseValueSinkNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineInput("value", typeof(BaseValue), "Base Value");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphNode("sample.interface-sink", "Interface Value Sink", "Samples")]
    public sealed class InterfaceValueSinkNode : NodeModel<EmptyState>
    {
        public InterfaceValueSinkNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineInput("value", typeof(IValue), "IValue");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphNode("sample.base-source", "Base Value Source", "Samples")]
    public sealed class BaseValueSourceNode : NodeModel<EmptyState>
    {
        public BaseValueSourceNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineOutput("value", typeof(BaseValue), "Base Value");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphNode("sample.derived-sink", "Derived Value Sink", "Samples")]
    public sealed class DerivedValueSinkNode : NodeModel<EmptyState>
    {
        public DerivedValueSinkNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            DefineInput("value", typeof(DerivedValue), "Derived Value");
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }

    [GraphNode("sample.dynamic", "Dynamic Outputs", "Samples")]
    public sealed class DynamicOutputNode : NodeModel<EmptyState>
    {
        public DynamicOutputNode(Guid id) : base(id)
        {
        }

        protected override void OnInitialize()
        {
            AddDynamicPort(new PortDefinition(
                "output-1",
                PortDirection.Output,
                "system.float",
                PortCapacity.Multiple,
                "Output 1"));
        }

        internal void AddOutput()
        {
            var index = Ports.Count + 1;
            AddDynamicPort(new PortDefinition(
                $"output-{index}",
                PortDirection.Output,
                "system.float",
                PortCapacity.Multiple,
                $"Output {index}"));
        }

        protected override EmptyState CaptureState()
        {
            return new EmptyState();
        }

        protected override void RestoreState(EmptyState state)
        {
        }
    }
}
