using System;

namespace NodeGraph.Flow
{
    public sealed class Subscription : IDisposable
    {
        private Action _disposeAction;

        public Subscription(Action disposeAction)
        {
            _disposeAction = disposeAction;
        }

        public void Dispose()
        {
            var disposeAction = _disposeAction;

            if (disposeAction == null)
            {
                return;
            }

            _disposeAction = null;
            disposeAction.Invoke();
        }
    }
}
