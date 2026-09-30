using System;
using NodeGraph.Core;
using NodeGraph.UI;
using R3;
using UnityEngine;
using UnityEngine.UIElements;

namespace NodeGraph.Samples
{
    [NodeViewFor(typeof(NumberNode), "NodeGraph/Views/Samples/NumberNode")]
    public sealed class NumberNodeView : NodeView
    {
        public NumberNodeView(NodeViewModel viewModel) : base(viewModel)
        {
            var model = (NumberNode)viewModel.Model;
            var field = Body.Q<FloatField>("value-field");
            if (field == null)
            {
                throw new InvalidOperationException("NumberNode.uxml must contain value-field.");
            }

            field.SetValueWithoutNotify(model.Value);
            field.RegisterValueChangedCallback(change => viewModel.RequestNumberValue(change.newValue));
            Bindings.Add(model.Changes.Subscribe(change =>
            {
                if (change.Kind == NodeChangeKind.State)
                {
                    field.SetValueWithoutNotify(model.Value);
                }
            }));
        }
    }

    [NodeViewFor(typeof(FloatSinkNode), "NodeGraph/Views/Samples/FloatSinkNode")]
    public sealed class FloatSinkNodeView : NodeView
    {
        public FloatSinkNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(DerivedValueSourceNode), "NodeGraph/Views/Samples/DerivedValueSourceNode")]
    public sealed class DerivedValueSourceNodeView : NodeView
    {
        public DerivedValueSourceNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(BaseValueSinkNode), "NodeGraph/Views/Samples/BaseValueSinkNode")]
    public sealed class BaseValueSinkNodeView : NodeView
    {
        public BaseValueSinkNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(BaseValueSourceNode), "NodeGraph/Views/Samples/BaseValueSourceNode")]
    public sealed class BaseValueSourceNodeView : NodeView
    {
        public BaseValueSourceNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(InterfaceValueSinkNode), "NodeGraph/Views/Samples/BaseValueSinkNode")]
    public sealed class InterfaceValueSinkNodeView : NodeView
    {
        public InterfaceValueSinkNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(DerivedValueSinkNode), "NodeGraph/Views/Samples/DerivedValueSinkNode")]
    public sealed class DerivedValueSinkNodeView : NodeView
    {
        public DerivedValueSinkNodeView(NodeViewModel viewModel) : base(viewModel)
        {
        }
    }

    [NodeViewFor(typeof(DynamicOutputNode), "NodeGraph/Views/Samples/DynamicOutputNode")]
    public sealed class DynamicOutputNodeView : NodeView
    {
        public DynamicOutputNodeView(NodeViewModel viewModel) : base(viewModel)
        {
            var model = (DynamicOutputNode)viewModel.Model;
            var button = Body.Q<Button>("add-output-button");
            if (button == null)
            {
                throw new InvalidOperationException("DynamicOutputNode.uxml must contain add-output-button.");
            }
            button.clicked += viewModel.RequestAddDynamicOutput;
        }
    }
}
