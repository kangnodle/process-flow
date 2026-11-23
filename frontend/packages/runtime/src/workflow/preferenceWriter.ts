import {
  transitionPreferences,
  type PreferencesEvent,
  type PreferencesState,
  type SavedWorkflow,
  type WorkflowRepository,
  type WorkspacePreferences,
} from '@process-flow/application';

export class PreferenceWriter {
  private state: PreferencesState = { kind: 'idle', sequence: 0 };
  private running: Promise<void> | undefined;
  private active = true;

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly current: () => SavedWorkflow | undefined,
    private readonly changed: () => void,
  ) {}

  get error(): string | undefined {
    return this.state.kind === 'failed' ? this.state.error : undefined;
  }

  save(patch: WorkspacePreferences): Promise<void> {
    if (!this.active) return Promise.resolve();
    const saved = this.current();
    if (!saved || !this.repository.savePreferences || !(saved.permissions?.includes('preferences.save') ?? true))
      return Promise.resolve();
    this.send({ type: 'change', patch });
    return this.settled();
  }

  retry = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    this.send({ type: 'retry' });
    return this.settled();
  };

  stop(): void {
    this.active = false;
    this.send({ type: 'stop' });
  }
  resume(): void {
    this.active = true;
  }

  private async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  private send(event: PreferencesEvent): void {
    const transition = transitionPreferences(this.state, event);
    this.state = transition.state;
    this.changed();
    for (const effect of transition.effects) {
      const saved = this.current();
      if (
        !this.active ||
        !saved ||
        !this.repository.savePreferences ||
        !(saved.permissions?.includes('preferences.save') ?? true)
      ) {
        this.send({
          type: 'failed',
          request: effect.request,
          error: 'Settings cannot be saved in the current workspace.',
        });
        continue;
      }
      const operation = this.perform(saved.id, effect.request, effect.patch);
      this.running = operation;
      void operation.then(() => {
        if (this.running === operation) this.running = undefined;
      });
    }
  }

  private async perform(id: string, request: number, patch: WorkspacePreferences): Promise<void> {
    try {
      await this.repository.savePreferences!(id, patch);
      this.send({ type: 'saved', request });
    } catch (error) {
      this.send({ type: 'failed', request, error: String(error) });
    }
  }
}
