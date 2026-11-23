import { expect, it, vi } from 'vitest';
import type { AuthRepository, AuthStatus } from '@process-flow/application';
import { AuthSession } from './authSession';

const user = { id: 'user', email: 'user@example.com', name: 'User', active: true, isAdmin: false, version: 0 };

it('does not restore a user from an old request after expiration', async () => {
  let release!: (status: AuthStatus) => void;
  let expire!: () => void;
  const repository: AuthRepository = {
    status: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    setup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    onSessionExpired: (listener) => {
      expire = listener;
      return vi.fn();
    },
  };
  const session = new AuthSession(repository);
  const stop = session.start();
  expire();
  release({ setupRequired: false, user });
  await Promise.resolve();
  expect(session.getSnapshot()).toEqual({ phase: 'login', expired: true });
  stop();
});

it('reports logout failure and keeps the signed-in snapshot', async () => {
  const repository: AuthRepository = {
    status: async () => ({ setupRequired: false, user }),
    setup: vi.fn(),
    login: vi.fn(),
    logout: async () => {
      throw new Error('offline');
    },
    changePassword: vi.fn(),
    onSessionExpired: () => vi.fn(),
  };
  const session = new AuthSession(repository);
  const stop = session.start();
  await Promise.resolve();
  await expect(session.logout()).rejects.toThrow('offline');
  expect(session.getSnapshot()).toEqual({ phase: 'ready', user });
  stop();
});
