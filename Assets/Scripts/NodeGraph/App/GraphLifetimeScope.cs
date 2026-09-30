using System;
using NodeGraph.Core;
using NodeGraph.Flow;
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

            builder.Register<IEventBus, EventBus>(Lifetime.Scoped);
            builder.Register<StateMachine>(Lifetime.Scoped);
            builder.Register<GraphSession>(container => new GraphSession(new GraphModel(container.Resolve<NodeGraphRegistry>())), Lifetime.Scoped);
            builder.Register<IGraphMutationService, GraphMutationService>(Lifetime.Scoped);
            builder.Register<ISampleNodeMutationService, SampleNodeMutationService>(Lifetime.Scoped);
            builder.Register<GraphViewModel>(Lifetime.Scoped);
            builder.Register<GraphMutationState>(Lifetime.Scoped);
            builder.Register<GraphDocumentState>(Lifetime.Scoped);
            builder.Register<SampleNodeState>(Lifetime.Scoped);
            builder.RegisterEntryPoint<GraphStateLifetime>();
            builder.Register<GraphJsonSerializer>(Lifetime.Singleton);
            builder.Register<IGraphFileDialog, SfbGraphFileDialog>(Lifetime.Singleton);
            builder.Register<GraphFileService>(Lifetime.Singleton);
            builder.Register<GraphEditorController>(Lifetime.Scoped);
            builder.RegisterComponentInHierarchy<GraphEditorHost>();
        }
    }
}
