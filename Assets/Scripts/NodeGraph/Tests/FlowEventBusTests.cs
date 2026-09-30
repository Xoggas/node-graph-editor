using System;
using NUnit.Framework;
using NodeGraph.Flow;

namespace NodeGraph.Tests
{
    public sealed class FlowEventBusTests
    {
        [Test]
        public void InvokeNotifiesSubscribers()
        {
            var eventBus = new EventBus();
            var calls = 0;
            using var subscription = eventBus.Subscribe<ProbeEvent>(_ => calls++);

            eventBus.Invoke(new ProbeEvent());

            Assert.That(calls, Is.EqualTo(1));
        }

        [Test]
        public void DisposeRemovesSubscriber()
        {
            var eventBus = new EventBus();
            var calls = 0;
            var subscription = eventBus.Subscribe<ProbeEvent>(_ => calls++);

            subscription.Dispose();
            eventBus.Invoke(new ProbeEvent());

            Assert.That(calls, Is.EqualTo(0));
        }

        [Test]
        public void SubscriptionMutationIsDeferredDuringInvoke()
        {
            var eventBus = new EventBus();
            var firstCalls = 0;
            var secondCalls = 0;
            IDisposable secondSubscription = null;
            using var firstSubscription = eventBus.Subscribe<ProbeEvent>(_ =>
            {
                firstCalls++;
                secondSubscription ??= eventBus.Subscribe<ProbeEvent>(_ => secondCalls++);
            });

            eventBus.Invoke(new ProbeEvent());
            eventBus.Invoke(new ProbeEvent());

            Assert.That(firstCalls, Is.EqualTo(2));
            Assert.That(secondCalls, Is.EqualTo(1));
            secondSubscription?.Dispose();
        }

        private readonly struct ProbeEvent : ISyncEvent
        {
        }
    }
}
