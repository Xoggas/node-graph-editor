using System;
using System.Collections.Generic;
using Cysharp.Threading.Tasks;
namespace NodeGraph.Flow
{
    public sealed class StateMachine
    {
        private readonly Dictionary<Type, State> _states = new();
        private State _currentState;
        private Type _requestedStateType;
        private bool _isProcessing;

        public Type CurrentStateType => _currentState?.GetType();

        public void RegisterState(State state)
        {
            if (state is null)
            {
                throw new ArgumentNullException(nameof(state));
            }

            _states[state.GetType()] = state;
        }

        public void ChangeState<T>() where T : State
        {
            ChangeState(typeof(T));
        }

        private void ChangeState(Type stateType)
        {
            if (!_states.ContainsKey(stateType))
            {
                throw new Exception($"State {stateType.Name} not found");
            }

            _requestedStateType = stateType;

            if (!_isProcessing)
            {
                ProcessTransitionsAsync().Forget();
            }
        }

        private async UniTaskVoid ProcessTransitionsAsync()
        {
            _isProcessing = true;

            try
            {
                while (_requestedStateType is not null)
                {
                    var requestedStateType = _requestedStateType;
                    _requestedStateType = null;

                    if (_currentState?.GetType() == requestedStateType)
                    {
                        continue;
                    }

                    var nextState = _states[requestedStateType];

                    if (_currentState is not null)
                    {
                        await _currentState.ExitAsync();
                    }

                    _currentState = nextState;
                    await _currentState.EnterAsync();
                }
            }
            finally
            {
                _isProcessing = false;

                if (_requestedStateType is not null)
                {
                    ProcessTransitionsAsync().Forget();
                }
            }
        }
    }
}
