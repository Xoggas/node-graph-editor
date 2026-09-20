#if UNITY_INCLUDE_TESTS
using System.Linq;
using NUnit.Framework;
using NodeGraph.Core;
using NodeGraph.Samples;
using NodeGraph.Serialization;
using UnityEngine;

namespace NodeGraph.Tests
{
    public sealed class GraphModelTests
    {
        private NodeGraphRegistry _registry;

        [SetUp]
        public void SetUp()
        {
            _registry = NodeGraphRegistry.Scan(typeof(NumberNode).Assembly);
        }

        [Test]
        public void DerivedTypeCanConnectToBaseInput()
        {
            using (var graph = new GraphModel(_registry))
            {
                var source = graph.AddNode("sample.derived-source", Vector2.zero);
                var sink = graph.AddNode("sample.base-sink", new Vector2(100, 0));

                var result = graph.TryConnect(source.Ports.Single(), sink.Ports.Single());

                Assert.That(result.Success, Is.True, result.Message);
                Assert.That(source.GetOutputNodes(source.Ports.Single()), Is.EqualTo(new[] { sink }));
                Assert.That(sink.GetInputNodes(sink.Ports.Single()), Is.EqualTo(new[] { source }));
            }
        }

        [Test]
        public void DerivedTypeCanConnectToInterfaceInput()
        {
            using (var graph = new GraphModel(_registry))
            {
                var source = graph.AddNode("sample.derived-source", Vector2.zero);
                var sink = graph.AddNode("sample.interface-sink", new Vector2(100, 0));

                var result = graph.TryConnect(source.Ports.Single(), sink.Ports.Single());

                Assert.That(result.Success, Is.True, result.Message);
            }
        }

        [Test]
        public void BaseTypeCannotConnectToDerivedInput()
        {
            using (var graph = new GraphModel(_registry))
            {
                var source = graph.AddNode("sample.base-source", Vector2.zero);
                var sink = graph.AddNode("sample.derived-sink", new Vector2(100, 0));
                var result = graph.TryConnect(source.Ports.Single(), sink.Ports.Single());

                Assert.That(result.Success, Is.False);
                Assert.That(result.FailureReason, Is.EqualTo(ConnectionFailureReason.IncompatibleTypes));
            }
        }

        [Test]
        public void SingleInputRejectsSecondConnection()
        {
            using (var graph = new GraphModel(_registry))
            {
                var first = graph.AddNode("sample.number", Vector2.zero);
                var second = graph.AddNode("sample.number", new Vector2(100, 0));
                var sink = graph.AddNode("sample.sink", new Vector2(200, 0));
                var input = sink.Ports.Single();

                Assert.That(graph.TryConnect(first.Ports.Single(), input).Success, Is.True);
                var result = graph.TryConnect(second.Ports.Single(), input);

                Assert.That(result.Success, Is.False);
                Assert.That(result.FailureReason, Is.EqualTo(ConnectionFailureReason.InputCapacityReached));
                Assert.That(sink.GetInputNodes(input).Single(), Is.EqualTo(first));
            }
        }

        [Test]
        public void JsonRoundTripRestoresStatePortsAndConnections()
        {
            using (var graph = new GraphModel(_registry))
            {
                var number = (NumberNode)graph.AddNode("sample.number", new Vector2(10, 20));
                number.SetValue(42.5f);
                var sink = graph.AddNode("sample.sink", new Vector2(300, 20));
                Assert.That(graph.TryConnect(number.Ports.Single(), sink.Ports.Single()).Success, Is.True);

                var serializer = new GraphJsonSerializer(_registry);
                var json = serializer.Serialize(graph);
                var loaded = serializer.Deserialize(json);

                using (loaded.Graph)
                {
                    var loadedNumber = (NumberNode)loaded.Graph.Nodes.Single(x => x.TypeId == "sample.number");
                    Assert.That(loadedNumber.Value, Is.EqualTo(42.5f).Within(0.001f));
                    Assert.That(loaded.Graph.Connections, Has.Count.EqualTo(1));
                    Assert.That(loaded.Warnings, Is.Empty);
                    Assert.That(loaded.Graph.Nodes.All(x => x.Ports.All(p => p.Id != System.Guid.Empty)), Is.True);
                }
            }
        }

        [Test]
        public void UnknownNodeLoadsAsPlaceholderAndRoundTrips()
        {
            var graphJson = @"{
  ""format"": ""node-graph"",
  ""version"": 1,
  ""graphId"": ""11111111-1111-1111-1111-111111111111"",
  ""viewport"": { ""position"": { ""x"": 0, ""y"": 0 }, ""zoom"": 1 },
  ""nodes"": [
    {
      ""id"": ""22222222-2222-2222-2222-222222222222"",
      ""typeId"": ""missing.node"",
      ""position"": { ""x"": 1, ""y"": 2 },
      ""ports"": [
        { ""id"": ""33333333-3333-3333-3333-333333333333"", ""key"": ""out"", ""direction"": ""Output"", ""capacity"": ""Multiple"", ""typeId"": ""missing.type"", ""displayName"": ""Out"", ""isDynamic"": true }
      ],
      ""state"": { ""value"": 10 }
    }
  ],
  ""connections"": [],
  ""unresolvedConnections"": []
}";

            var serializer = new GraphJsonSerializer(_registry);
            var result = serializer.Deserialize(graphJson);
            using (result.Graph)
            {
                Assert.That(result.Graph.Nodes.Single(), Is.TypeOf<PlaceholderNodeModel>());
                Assert.That(result.Warnings, Has.Count.EqualTo(1));
                var roundTrip = serializer.Serialize(result.Graph);
                Assert.That(roundTrip, Does.Contain("missing.node"));
                Assert.That(roundTrip, Does.Contain("missing.type"));
            }
        }
    }
}
#endif
