using System;
using System.Collections.Generic;

namespace NodeGraph.Flow
{
    public sealed partial class EventBus
    {
        private sealed class SyncEventChannel<T> : EventChannel where T : ISyncEvent
        {
            private readonly HashSet<Action<T>> _subscribers = new();

            public IDisposable Subscribe(Action<T> action)
            {
                Mutate(() => _subscribers.Add(action));

                return new Subscription(() => Mutate(() => _subscribers.Remove(action)));
            }

            public void Invoke(T evt)
            {
                BeginInvocation();

                try
                {
                    foreach (var subscriber in _subscribers)
                    {
                        subscriber.Invoke(evt);
                    }
                }
                finally
                {
                    EndInvocation();
                }
            }
        }
    }
}
