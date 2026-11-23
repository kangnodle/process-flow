import { expect, it } from 'vitest';
import { createAuthState, transitionAuth } from './authMachine';

const user = { id: 'user', email: 'user@example.com', name: 'User', active: true, isAdmin: false, version: 0 };

it('ignores an old status response after the session expires', () => {
  const loading = transitionAuth(createAuthState(), { type: 'load' });
  const expired = transitionAuth(loading.state, { type: 'expired' });
  const stale = transitionAuth(expired.state, { type: 'loaded', request: 1, status: { setupRequired: false, user } });
  expect(stale.state).toBe(expired.state);
  expect(stale.state.session).toEqual({ phase: 'login', expired: true });
});

it('keeps authentication errors explicit and transitions conflicting setup to login', () => {
  const initial = transitionAuth(createAuthState(), { type: 'load' });
  const setup = transitionAuth(initial.state, { type: 'loaded', request: 1, status: { setupRequired: true } });
  const started = transitionAuth(setup.state, { type: 'authenticate', operation: 'setup' });
  const failed = transitionAuth(started.state, { type: 'authenticationFailed', request: 2, errorKind: 'conflict' });
  expect(failed.state.session).toEqual({ phase: 'login', expired: false });
  expect(JSON.stringify(started.state)).not.toContain('password');
});

it('preserves the signed-in user when server logout fails', () => {
  const loading = transitionAuth(createAuthState(), { type: 'load' });
  const ready = transitionAuth(loading.state, { type: 'loaded', request: 1, status: { setupRequired: false, user } });
  const leaving = transitionAuth(ready.state, { type: 'logout' });
  const failed = transitionAuth(leaving.state, { type: 'logoutFailed', request: 2 });
  expect(failed.state.session).toEqual({ phase: 'ready', user });
});
