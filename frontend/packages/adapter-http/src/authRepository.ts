import { RequestError, type AuthRepository, type AuthStatus } from '@process-flow/application';
import { createJsonCall } from './jsonClient';
import { decodeUser } from './userRepository';

function decodeStatus(value: unknown): AuthStatus {
  const { setupRequired, user } = (value ?? {}) as Record<string, unknown>;
  if (typeof setupRequired !== 'boolean') throw new RequestError('unknown', 'Invalid auth status response');
  return user == null ? { setupRequired } : { setupRequired, user: decodeUser(user) };
}

export function createAuthClient(
  request: typeof fetch = fetch,
  base = '/api/v1',
): {
  readonly authRepository: AuthRepository;
  readonly request: typeof fetch;
  readonly sessionGeneration: () => number;
} {
  const call = createJsonCall(request, base);
  const listeners = new Set<() => void>();
  let generation = 0;
  const watched: typeof fetch = async (input, init) => {
    const requestedGeneration = generation;
    const response = await request(input, init);
    if (response.status === 401 && requestedGeneration === generation) {
      generation += 1;
      listeners.forEach((listener) => listener());
    }
    return response;
  };
  return {
    request: watched,
    sessionGeneration: () => generation,
    authRepository: {
      async status() {
        return decodeStatus(await call('/auth/status'));
      },
      async setup(input) {
        generation += 1;
        const user = decodeUser(await call('/auth/setup', 'POST', input));
        generation += 1;
        return user;
      },
      async login(email, password) {
        generation += 1;
        const user = decodeUser(await call('/auth/login', 'POST', { email, password }));
        generation += 1;
        return user;
      },
      async logout() {
        generation += 1;
        await call('/auth/logout', 'POST');
        generation += 1;
      },
      async changePassword(current, next) {
        await call('/auth/password', 'POST', { currentPassword: current, newPassword: next });
      },
      onSessionExpired(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
}
