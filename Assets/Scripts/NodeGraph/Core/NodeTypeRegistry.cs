using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;

namespace NodeGraph.Core
{
    public sealed class NodeTypeDescriptor
    {
        public string TypeId { get; }
        public string DisplayName { get; }
        public string MenuPath { get; }
        public Type ModelType { get; }

        internal NodeTypeDescriptor(string typeId, string displayName, string menuPath, Type modelType)
        {
            TypeId = typeId;
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? typeId : displayName;
            MenuPath = menuPath ?? string.Empty;
            ModelType = modelType;
        }
    }

    public sealed class NodeTypeRegistry
    {
        private readonly Dictionary<string, NodeTypeDescriptor> _descriptors = new Dictionary<string, NodeTypeDescriptor>(StringComparer.Ordinal);

        public GraphTypeRegistry DataTypes { get; }
        public IReadOnlyDictionary<string, NodeTypeDescriptor> Descriptors => _descriptors;

        public NodeTypeRegistry(GraphTypeRegistry dataTypes)
        {
            DataTypes = dataTypes ?? throw new ArgumentNullException(nameof(dataTypes));
        }

        public void Register(string typeId, Type modelType, string displayName = null, string menuPath = null)
        {
            if (string.IsNullOrWhiteSpace(typeId))
            {
                throw new ArgumentException("A node type id is required.", nameof(typeId));
            }
            if (modelType == null || !typeof(NodeModel).IsAssignableFrom(modelType) || modelType.IsAbstract)
            {
                throw new ArgumentException("The model type must be a concrete NodeModel.", nameof(modelType));
            }

            if (_descriptors.TryGetValue(typeId, out var existing) && existing.ModelType != modelType)
            {
                throw new RegistryException($"Node type id '{typeId}' is already registered for '{existing.ModelType.FullName}'.");
            }

            _descriptors[typeId] = new NodeTypeDescriptor(typeId, displayName, menuPath, modelType);
        }

        public bool TryGet(string typeId, out NodeTypeDescriptor descriptor)
        {
            return _descriptors.TryGetValue(typeId ?? string.Empty, out descriptor);
        }

        public NodeModel CreateNode(string typeId, Guid id)
        {
            if (!TryGet(typeId, out var descriptor))
            {
                throw new RegistryException($"Unknown node type '{typeId}'.");
            }

            NodeModel node;
            try
            {
                node = (NodeModel)Activator.CreateInstance(
                    descriptor.ModelType,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic,
                    null,
                    new object[] { id },
                    CultureInfo.InvariantCulture);
            }
            catch (Exception exception)
            {
                throw new RegistryException(
                    $"Could not create node '{typeId}'. It must expose a constructor accepting Guid.",
                    exception);
            }

            node.SetTypeId(typeId);
            node.SetDisplayName(descriptor.DisplayName);
            node.InitializeFresh(DataTypes);
            return node;
        }
    }

    public sealed class NodeGraphRegistry
    {
        public GraphTypeRegistry DataTypes { get; }
        public NodeTypeRegistry Nodes { get; }

        public NodeGraphRegistry(GraphTypeRegistry dataTypes, NodeTypeRegistry nodes)
        {
            DataTypes = dataTypes ?? throw new ArgumentNullException(nameof(dataTypes));
            Nodes = nodes ?? throw new ArgumentNullException(nameof(nodes));
        }

        public static NodeGraphRegistry Scan(params Assembly[] assemblies)
        {
            var dataTypes = new GraphTypeRegistry();
            var nodes = new NodeTypeRegistry(dataTypes);
            var registry = new NodeGraphRegistry(dataTypes, nodes);
            registry.ScanAssemblies(assemblies == null || assemblies.Length == 0
                ? AppDomain.CurrentDomain.GetAssemblies()
                : assemblies);
            return registry;
        }

        public void ScanAssemblies(IEnumerable<Assembly> assemblies)
        {
            foreach (var assembly in assemblies)
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

                foreach (var type in types)
                {
                    if (type == null)
                    {
                        continue;
                    }

                    var dataTypeAttribute = type.GetCustomAttribute<GraphDataTypeAttribute>();
                    if (dataTypeAttribute != null)
                    {
                        DataTypes.Register(dataTypeAttribute.TypeId, type);
                    }

                    var nodeAttribute = type.GetCustomAttribute<GraphNodeAttribute>();
                    if (nodeAttribute != null)
                    {
                        Nodes.Register(nodeAttribute.TypeId, type, nodeAttribute.DisplayName, nodeAttribute.MenuPath);
                    }
                }
            }
        }
    }
}
