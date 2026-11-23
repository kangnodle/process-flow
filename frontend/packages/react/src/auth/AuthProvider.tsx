import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthRepository } from '@process-flow/application';
import { AuthSession } from '@process-flow/runtime';
import { AuthContext, type AuthGate, type AuthValue } from './authContext';

interface AuthProviderProps {
  readonly repository: AuthRepository;
  readonly renderGate: (gate: AuthGate) => ReactNode;
  readonly children: ReactNode;
}

export function AuthProvider({ repository, renderGate, children }: AuthProviderProps) {
  const session = useMemo(() => new AuthSession(repository), [repository]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => session.start(), [session]);
  const value = useMemo<AuthValue | undefined>(
    () =>
      state.phase === 'ready'
        ? { user: state.user, logout: session.logout, changePassword: session.changePassword }
        : undefined,
    [state, session],
  );
  if (state.phase !== 'ready')
    return (
      <>
        {renderGate({
          phase: state.phase,
          expired: state.phase === 'login' && state.expired,
          setup: session.setup,
          login: session.login,
          retry: session.retry,
        })}
      </>
    );
  return <AuthContext.Provider value={value ?? null}>{children}</AuthContext.Provider>;
}
