using Cysharp.Threading.Tasks;
using System;
using System.Collections.Generic;
using System.Threading;

namespace NodeGraph.Flow
{
    public sealed partial class EventBus
    {
        private sealed class AsyncEventChannel<T> : EventChannel where T : IAsyncEvent
        {
            private readonly HashSet<Func<T, CancellationToken, UniTask>> _subscribers = new();

            public IDisposable Subscribe(Func<T, CancellationToken, UniTask> action)
            {
                Mutate(() => _subscribers.Add(action));

                return new Subscription(() => Mutate(() => _subscribers.Remove(action)));
            }

            public async UniTask InvokeAsync(T evt, CancellationToken cancellationToken)
            {
                cancellationToken.ThrowIfCancellationRequested();

                BeginInvocation();

                try
                {
                    var tasks = new UniTask[_subscribers.Count];
                    var index = 0;

                    foreach (var subscriber in _subscribers)
                    {
                        tasks[index++] = subscriber.Invoke(evt, cancellationToken);
                    }

                    await UniTask.WhenAll(tasks);
                }
                finally
                {
                    EndInvocation();
                }
            }
        }
    }
}
