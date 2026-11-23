import { RequestError, type AuthRepository } from '@process-flow/application';
import { type User } from '@process-flow/domain';

interface Account {
  user: User;
  password: string;
}

export function createFakeAuth({
  accounts = [],
  signedIn,
  failStatus = false,
}: {
  readonly accounts?: readonly { email: string; name: string; password: string; isAdmin?: boolean }[];
  readonly signedIn?: string;
  readonly failStatus?: boolean;
} = {}) {
  const stored: Account[] = accounts.map((account, index) => ({
    user: {
      id: `a${index + 1}`,
      email: account.email,
      name: account.name,
      active: true,
      isAdmin: account.isAdmin ?? false,
      version: 0,
    },
    password: account.password,
  }));
  let current = stored.find((account) => account.user.email === signedIn);
  let down = failStatus;
  const listeners = new Set<() => void>();

  const authRepository: AuthRepository = {
    async status() {
      if (down) throw new RequestError('unknown', 'down');
      const setupRequired = !current && !stored.some((account) => account.user.isAdmin);
      return current ? { setupRequired, user: current.user } : { setupRequired };
    },
    async setup({ email, name, password }) {
      if (stored.some((account) => account.user.isAdmin)) throw new RequestError('conflict', 'setup done');
      const account = {
        user: { id: `a${stored.length + 1}`, email, name, active: true, isAdmin: true, version: 0 },
        password,
      };
      stored.push(account);
      current = account;
      return account.user;
    },
    async login(email, password) {
      const account = stored.find((candidate) => candidate.user.email === email);
      if (!account || account.password !== password) throw new RequestError('invalidCredentials', 'wrong');
      current = account;
      return account.user;
    },
    async logout() {
      current = undefined;
    },
    async changePassword(currentPassword, next) {
      if (!current) throw new RequestError('unauthenticated', 'signed out');
      if (current.password !== currentPassword) throw new RequestError('invalid', 'wrong current password');
      current.password = next;
    },
    onSessionExpired(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    authRepository,
    signedInAs: () => current?.user.email,
    passwordOf: (email: string) => stored.find((account) => account.user.email === email)?.password,
    expire() {
      current = undefined;
      listeners.forEach((listener) => listener());
    },
    addAdmin(email: string, password: string) {
      stored.push({
        user: { id: `a${stored.length + 1}`, email, name: email, active: true, isAdmin: true, version: 0 },
        password,
      });
    },
    recover() {
      down = false;
    },
  };
}
