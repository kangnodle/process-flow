import type { User } from '@process-flow/domain';
import type { RequestErrorKind } from '../../errors';
import type { AuthStatus } from '../../ports';

export type AuthSessionState =
  | { readonly phase: 'loading'; readonly request: number }
  | { readonly phase: 'unavailable' }
  | { readonly phase: 'setup' }
  | { readonly phase: 'login'; readonly expired: boolean }
  | {
      readonly phase: 'authenticating';
      readonly request: number;
      readonly origin: 'login' | 'setup';
      readonly expired: boolean;
    }
  | { readonly phase: 'ready'; readonly user: User }
  | { readonly phase: 'signingOut'; readonly request: number; readonly user: User };

export interface AuthState {
  readonly sequence: number;
  readonly session: AuthSessionState;
}
export type AuthEvent =
  | { readonly type: 'load' }
  | { readonly type: 'loaded'; readonly request: number; readonly status: AuthStatus }
  | { readonly type: 'loadFailed'; readonly request: number }
  | { readonly type: 'authenticate'; readonly operation: 'login' | 'setup' }
  | { readonly type: 'authenticated'; readonly request: number; readonly user: User }
  | { readonly type: 'authenticationFailed'; readonly request: number; readonly errorKind: RequestErrorKind }
  | { readonly type: 'logout' }
  | { readonly type: 'loggedOut'; readonly request: number }
  | { readonly type: 'logoutFailed'; readonly request: number }
  | { readonly type: 'expired' }
  | { readonly type: 'stopped' };
export type AuthEffect =
  | { readonly type: 'load'; readonly request: number }
  | { readonly type: 'authenticate'; readonly request: number; readonly operation: 'login' | 'setup' }
  | { readonly type: 'logout'; readonly request: number };

export function createAuthState(): AuthState {
  return { sequence: 0, session: { phase: 'loading', request: 0 } };
}

export function transitionAuth(
  model: AuthState,
  event: AuthEvent,
): { readonly state: AuthState; readonly effects: readonly AuthEffect[] } {
  const { session } = model;
  const unchanged = { state: model, effects: [] };
  const request = model.sequence + 1;
  const withSession = (next: AuthSessionState) => ({ state: { ...model, session: next }, effects: [] });
  switch (event.type) {
    case 'load':
      return {
        state: { sequence: request, session: { phase: 'loading', request } },
        effects: [{ type: 'load', request }],
      };
    case 'loaded':
      if (session.phase !== 'loading' || session.request !== event.request) return unchanged;
      return withSession(
        event.status.user
          ? { phase: 'ready', user: event.status.user }
          : event.status.setupRequired
            ? { phase: 'setup' }
            : { phase: 'login', expired: false },
      );
    case 'loadFailed':
      return session.phase === 'loading' && session.request === event.request
        ? withSession({ phase: 'unavailable' })
        : unchanged;
    case 'authenticate': {
      if (session.phase !== event.operation) return unchanged;
      return {
        state: {
          sequence: request,
          session: {
            phase: 'authenticating',
            request,
            origin: event.operation,
            expired: session.phase === 'login' && session.expired,
          },
        },
        effects: [{ type: 'authenticate', request, operation: event.operation }],
      };
    }
    case 'authenticated':
      return session.phase === 'authenticating' && session.request === event.request
        ? withSession({ phase: 'ready', user: event.user })
        : unchanged;
    case 'authenticationFailed':
      if (session.phase !== 'authenticating' || session.request !== event.request) return unchanged;
      return withSession(
        session.origin === 'setup' && event.errorKind !== 'conflict'
          ? { phase: 'setup' }
          : { phase: 'login', expired: session.expired },
      );
    case 'logout':
      return session.phase === 'ready'
        ? {
            state: { sequence: request, session: { phase: 'signingOut', request, user: session.user } },
            effects: [{ type: 'logout', request }],
          }
        : unchanged;
    case 'loggedOut':
      return session.phase === 'signingOut' && session.request === event.request
        ? withSession({ phase: 'login', expired: false })
        : unchanged;
    case 'logoutFailed':
      return session.phase === 'signingOut' && session.request === event.request
        ? withSession({ phase: 'ready', user: session.user })
        : unchanged;
    case 'expired':
      return { state: { sequence: request, session: { phase: 'login', expired: true } }, effects: [] };
    case 'stopped':
      return { state: { sequence: request, session: { phase: 'loading', request } }, effects: [] };
  }
}

export function authSessionView({ session }: AuthState) {
  if (session.phase === 'authenticating')
    return session.origin === 'setup'
      ? { phase: 'setup' as const }
      : { phase: 'login' as const, expired: session.expired };
  if (session.phase === 'signingOut') return { phase: 'ready' as const, user: session.user };
  return session;
}
