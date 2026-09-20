using System;
using System.Collections.Generic;

namespace NodeGraph.Core
{
    public sealed class GraphTypeRegistry
    {
        private readonly Dictionary<string, Type> _types = new Dictionary<string, Type>(StringComparer.Ordinal);
        private readonly Dictionary<Type, string> _typeIds = new Dictionary<Type, string>();

        public GraphTypeRegistry()
        {
            Register("system.object", typeof(object));
            Register("system.bool", typeof(bool));
            Register("system.int", typeof(int));
            Register("system.float", typeof(float));
            Register("system.string", typeof(string));
        }

        public IReadOnlyDictionary<string, Type> Types => _types;

        public void Register(string typeId, Type type)
        {
            if (string.IsNullOrWhiteSpace(typeId))
            {
                throw new ArgumentException("A data type id is required.", nameof(typeId));
            }
            if (type == null)
            {
                throw new ArgumentNullException(nameof(type));
            }

            if (_types.TryGetValue(typeId, out var existing) && existing != type)
            {
                throw new RegistryException($"Data type id '{typeId}' is already registered for '{existing.FullName}'.");
            }
            if (_typeIds.TryGetValue(type, out var existingId) && existingId != typeId)
            {
                throw new RegistryException($"Type '{type.FullName}' is already registered as '{existingId}'.");
            }

            _types[typeId] = type;
            _typeIds[type] = typeId;
        }

        public bool TryResolve(string typeId, out Type type)
        {
            return _types.TryGetValue(typeId ?? string.Empty, out type);
        }

        public Type Resolve(string typeId)
        {
            if (!TryResolve(typeId, out var type))
            {
                throw new RegistryException($"Unknown graph data type '{typeId}'.");
            }
            return type;
        }

        public bool TryGetId(Type type, out string typeId)
        {
            return _typeIds.TryGetValue(type, out typeId);
        }

        public string GetId(Type type)
        {
            if (!TryGetId(type, out var typeId))
            {
                throw new RegistryException($"Type '{type?.FullName}' is not registered. Add [GraphDataType] or register it explicitly.");
            }
            return typeId;
        }
    }

    public sealed class RegistryException : Exception
    {
        public RegistryException(string message) : base(message)
        {
        }

        public RegistryException(string message, Exception innerException) : base(message, innerException)
        {
        }
    }
}
