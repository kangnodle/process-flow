import { createContext, useContext } from 'react';
import type { SetupInput } from '@process-flow/application';
import type { User } from '@process-flow/domain';

export interface AuthValue {
  readonly user: User;
  readonly logout: () => Promise<void>;
  readonly changePassword: (current: string, next: string) => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue | null {
  return useContext(AuthContext);
}

export interface AuthGate {
  readonly phase: 'loading' | 'unavailable' | 'setup' | 'login';
  readonly expired: boolean;
  readonly setup: (input: SetupInput) => Promise<void>;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly retry: () => void;
}
