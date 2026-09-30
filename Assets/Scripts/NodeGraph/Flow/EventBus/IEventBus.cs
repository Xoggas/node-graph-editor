using Cysharp.Threading.Tasks;
using System;
using System.Threading;

namespace NodeGraph.Flow
{
    public interface IEventBus
    {
        void Invoke<T>(T evt) where T : ISyncEvent;
        UniTask InvokeAsync<T>(T evt, CancellationToken cancellationToken = default) where T : IAsyncEvent;
        IDisposable Subscribe<T>(Action<T> action) where T : ISyncEvent;
        IDisposable Subscribe<T>(Func<T, CancellationToken, UniTask> action) where T : IAsyncEvent;
    }
}
