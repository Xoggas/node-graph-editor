using Cysharp.Threading.Tasks;
using System;
using System.Collections.Generic;
using System.Threading;

namespace NodeGraph.Flow
{
    public sealed partial class EventBus : IEventBus
    {
        private readonly Dictionary<Type, object> _channels = new();

        public IDisposable Subscribe<T>(Action<T> action) where T : ISyncEvent
        {
            return GetSyncChannel<T>().Subscribe(action);
        }

        public IDisposable Subscribe<T>(Func<T, CancellationToken, UniTask> action) where T : IAsyncEvent
        {
            return GetAsyncChannel<T>().Subscribe(action);
        }

        public void Invoke<T>(T evt) where T : ISyncEvent
        {
            if (TryGetChannel<T, SyncEventChannel<T>>(out var channel))
            {
                channel.Invoke(evt);
            }
        }

        public UniTask InvokeAsync<T>(T evt, CancellationToken cancellationToken = default) where T : IAsyncEvent
        {
            return TryGetChannel<T, AsyncEventChannel<T>>(out var channel)
                ? channel.InvokeAsync(evt, cancellationToken)
                : UniTask.CompletedTask;
        }

        private SyncEventChannel<T> GetSyncChannel<T>() where T : ISyncEvent
        {
            if (_channels.TryGetValue(typeof(T), out var value))
            {
                return (SyncEventChannel<T>)value;
            }

            var channel = new SyncEventChannel<T>();

            _channels.Add(typeof(T), channel);

            return channel;
        }

        private AsyncEventChannel<T> GetAsyncChannel<T>() where T : IAsyncEvent
        {
            if (_channels.TryGetValue(typeof(T), out var value))
            {
                return (AsyncEventChannel<T>)value;
            }

            var channel = new AsyncEventChannel<T>();

            _channels.Add(typeof(T), channel);

            return channel;
        }

        private bool TryGetChannel<T, TChannel>(out TChannel channel) where T : IEvent where TChannel : class
        {
            if (_channels.TryGetValue(typeof(T), out var value))
            {
                channel = (TChannel)value;
                return true;
            }

            channel = null;
            return false;
        }
    }
}
