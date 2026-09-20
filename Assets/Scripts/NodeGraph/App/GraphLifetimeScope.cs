using System;
using NodeGraph.Core;
using NodeGraph.Serialization;
using NodeGraph.UI;
using VContainer;
using VContainer.Unity;

namespace NodeGraph.App
{
    public sealed class GraphLifetimeScope : LifetimeScope
    {
        protected override void Configure(IContainerBuilder builder)
        {
            var registry = NodeGraphRegistry.Scan(AppDomain.CurrentDomain.GetAssemblies());
            var viewRegistry = new NodeViewRegistry();
            viewRegistry.Scan(AppDomain.CurrentDomain.GetAssemblies());

            builder.RegisterInstance(registry);
            builder.RegisterInstance(registry.DataTypes);
            builder.RegisterInstance(registry.Nodes);
            builder.RegisterInstance(viewRegistry);

            builder.Register<GraphModel>(container => new GraphModel(container.Resolve<NodeGraphRegistry>()), Lifetime.Scoped);
            builder.Register<GraphViewModel>(Lifetime.Scoped);
            builder.Register<GraphJsonSerializer>(Lifetime.Singleton);
            builder.Register<IGraphFileDialog, SfbGraphFileDialog>(Lifetime.Singleton);
            builder.Register<GraphFileService>(Lifetime.Singleton);
            builder.Register<GraphEditorController>(Lifetime.Scoped);
            builder.RegisterComponentInHierarchy<GraphEditorHost>();
        }
    }
}
