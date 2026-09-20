using System;
using System.Collections.Generic;
using System.Reflection;
using NodeGraph.Core;
using UnityEngine.UIElements;

namespace NodeGraph.UI
{
    public sealed class NodeViewRegistry
    {
        private readonly Dictionary<Type, Type> _viewTypes = new Dictionary<Type, Type>();

        public void Scan(params Assembly[] assemblies)
        {
            var source = assemblies == null || assemblies.Length == 0
                ? AppDomain.CurrentDomain.GetAssemblies()
                : assemblies;

            foreach (var assembly in source)
            {
                if (assembly == null || assembly.IsDynamic)
                {
                    continue;
                }

                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException exception)
                {
                    types = exception.Types;
                }

                foreach (var viewType in types)
                {
                    if (viewType == null || !typeof(NodeView).IsAssignableFrom(viewType) || viewType.IsAbstract)
                    {
                        continue;
                    }

                    var attribute = viewType.GetCustomAttribute<NodeViewForAttribute>();
                    if (attribute == null)
                    {
                        continue;
                    }
                    if (_viewTypes.TryGetValue(attribute.ModelType, out var existing) && existing != viewType)
                    {
                        throw new RegistryException($"A view is already registered for '{attribute.ModelType.FullName}'.");
                    }
                    _viewTypes[attribute.ModelType] = viewType;
                }
            }
        }

        public NodeView Create(NodeViewModel viewModel)
        {
            if (viewModel == null)
            {
                throw new ArgumentNullException(nameof(viewModel));
            }

            if (viewModel.Model is IPlaceholderNode)
            {
                return new PlaceholderNodeView(viewModel);
            }

            if (_viewTypes.TryGetValue(viewModel.Model.GetType(), out var viewType))
            {
                try
                {
                    return (NodeView)Activator.CreateInstance(viewType, viewModel);
                }
                catch (Exception exception)
                {
                    throw new RegistryException($"Could not create view '{viewType.FullName}'.", exception);
                }
            }

            return new DefaultNodeView(viewModel);
        }
    }

    public sealed class DefaultNodeView : NodeView
    {
        public DefaultNodeView(NodeViewModel viewModel) : base(viewModel)
        {
            LoadBodyTemplate("NodeGraph/Views/DefaultNode");
            var label = Body.Q<Label>("type-label");
            if (label == null)
            {
                throw new InvalidOperationException("DefaultNode.uxml must contain type-label.");
            }
            label.text = viewModel.TypeId;
        }
    }

    public sealed class PlaceholderNodeView : NodeView
    {
        public PlaceholderNodeView(NodeViewModel viewModel) : base(viewModel)
        {
            var placeholder = (IPlaceholderNode)viewModel.Model;
            LoadBodyTemplate("NodeGraph/Views/PlaceholderNode");
            var label = Body.Q<Label>("placeholder-label");
            if (label == null)
            {
                throw new InvalidOperationException("PlaceholderNode.uxml must contain placeholder-label.");
            }
            label.text = $"Unknown node type\n{placeholder.OriginalTypeId}";
        }
    }
}
