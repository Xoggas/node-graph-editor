using System;
using System.Collections.Generic;

namespace NodeGraph.Flow
{
    public abstract class EventChannel
    {
        private readonly List<Action> _pendingMutations = new();

        private int _invocationDepth;

        protected void Mutate(Action mutation)
        {
            if (_invocationDepth > 0)
            {
                _pendingMutations.Add(mutation);
                return;
            }

            mutation.Invoke();
        }

        protected void BeginInvocation()
        {
            _invocationDepth++;
        }

        protected void EndInvocation()
        {
            _invocationDepth--;

            if (_invocationDepth == 0)
            {
                FlushPendingMutations();
            }
        }

        private void FlushPendingMutations()
        {
            foreach (var mutation in _pendingMutations)
            {
                mutation.Invoke();
            }

            _pendingMutations.Clear();
        }
    }
}
