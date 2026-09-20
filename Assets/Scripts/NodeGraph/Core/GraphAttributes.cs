using System;

namespace NodeGraph.Core
{
    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class GraphNodeAttribute : Attribute
    {
        public new string TypeId { get; }
        public string DisplayName { get; }
        public string MenuPath { get; }

        public GraphNodeAttribute(string typeId, string displayName = null, string menuPath = null)
        {
            TypeId = typeId;
            DisplayName = displayName;
            MenuPath = menuPath;
        }
    }

    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Interface | AttributeTargets.Struct, Inherited = false)]
    public sealed class GraphDataTypeAttribute : Attribute
    {
        public new string TypeId { get; }

        public GraphDataTypeAttribute(string typeId)
        {
            TypeId = typeId;
        }
    }

    [AttributeUsage(AttributeTargets.Class, Inherited = false)]
    public sealed class NodeViewForAttribute : Attribute
    {
        public Type ModelType { get; }
        public string UxmlPath { get; }
        public string UssPath { get; }

        public NodeViewForAttribute(Type modelType, string uxmlPath = null, string ussPath = null)
        {
            ModelType = modelType;
            UxmlPath = uxmlPath;
            UssPath = ussPath;
        }
    }
}
