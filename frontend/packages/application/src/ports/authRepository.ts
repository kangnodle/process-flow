import type { User } from '@process-flow/domain';

export interface AuthStatus {
  readonly setupRequired: boolean;
  readonly user?: User;
}
export interface SetupInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}
export interface AuthRepository {
  status(): Promise<AuthStatus>;
  setup(input: SetupInput): Promise<User>;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  onSessionExpired(listener: () => void): () => void;
}
