import {
  authSessionView,
  createAuthState,
  errorKindOf,
  RequestError,
  transitionAuth,
  type AuthEvent,
  type AuthRepository,
  type SetupInput,
} from '@process-flow/application';
import type { User } from '@process-flow/domain';

export class AuthSession {
  private model = createAuthState();
  private snapshot = authSessionView(this.model);
  private readonly listeners = new Set<() => void>();

  constructor(private readonly repository: AuthRepository) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start = (): (() => void) => {
    const unsubscribe = this.repository.onSessionExpired(() => this.send({ type: 'expired' }));
    this.retry();
    return () => {
      unsubscribe();
      this.send({ type: 'stopped' });
    };
  };

  retry = (): void => {
    const effect = this.send({ type: 'load' })[0];
    if (effect?.type !== 'load') return;
    void this.repository.status().then(
      (status) => this.send({ type: 'loaded', request: effect.request, status }),
      () => this.send({ type: 'loadFailed', request: effect.request }),
    );
  };

  setup = (input: SetupInput): Promise<void> => this.authenticate('setup', () => this.repository.setup(input));
  login = (email: string, password: string): Promise<void> =>
    this.authenticate('login', () => this.repository.login(email, password));
  changePassword = (current: string, next: string): Promise<void> => this.repository.changePassword(current, next);

  logout = async (): Promise<void> => {
    const effect = this.send({ type: 'logout' })[0];
    if (effect?.type !== 'logout') return;
    try {
      await this.repository.logout();
      this.send({ type: 'loggedOut', request: effect.request });
    } catch (error) {
      this.send({ type: 'logoutFailed', request: effect.request });
      throw error;
    }
  };

  private async authenticate(operation: 'setup' | 'login', perform: () => Promise<User>): Promise<void> {
    const effect = this.send({ type: 'authenticate', operation })[0];
    if (effect?.type !== 'authenticate') throw new RequestError('conflict', 'Authentication is already in progress.');
    try {
      const user = await perform();
      this.send({ type: 'authenticated', request: effect.request, user });
    } catch (error) {
      this.send({ type: 'authenticationFailed', request: effect.request, errorKind: errorKindOf(error) });
      throw error;
    }
  }

  private send(event: AuthEvent) {
    const transition = transitionAuth(this.model, event);
    if (transition.state !== this.model) {
      this.model = transition.state;
      this.snapshot = authSessionView(this.model);
      this.listeners.forEach((listener) => listener());
    }
    return transition.effects;
  }
}
