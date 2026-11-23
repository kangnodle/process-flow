import type { AssignmentsInput, Process, TaskId, WorkflowAction } from '@process-flow/domain';
import {
  createWorkflowSessionState,
  errorKindOf,
  loadedSynchronization,
  RequestError,
  restoreDraftAction,
  transitionAssignments,
  transitionWorkflowSession,
  workflowPermission,
  workflowSessionSnapshot,
  type AssignmentSaveState,
  type Scheduler,
  type WorkflowFocus,
  type WorkflowRepository,
  type WorkflowSessionEffect,
  type WorkflowSessionEvent,
  type WorkspacePreferences,
} from '@process-flow/application';
import { PreferenceWriter } from './preferenceWriter';

export type { WorkspaceIdentity } from '@process-flow/application';

export class WorkflowSession {
  private model;
  private snapshot;
  private readonly listeners = new Set<() => void>();
  private opening: Promise<void> | undefined;
  private executing: Promise<void> | undefined;
  private cancelTimer: (() => void) | undefined;
  private readonly preferences: PreferenceWriter;
  private assignmentState: AssignmentSaveState = { kind: 'idle', sequence: 0 };
  private lifecycle = 0;

  constructor(
    private readonly process: Process,
    private readonly repository: WorkflowRepository,
    private readonly scheduler: Scheduler,
    private readonly focus?: WorkflowFocus,
  ) {
    this.model = createWorkflowSessionState(process);
    this.snapshot = { ...workflowSessionSnapshot(this.model), preferenceError: undefined as string | undefined };
    this.preferences = new PreferenceWriter(
      repository,
      () => loadedSynchronization(this.model)?.saved,
      () => this.publish(),
    );
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  open = (): Promise<void> => {
    if (this.opening) return this.opening;
    this.preferences.resume();
    this.send({ type: 'open' });
    return this.opening ?? Promise.resolve();
  };

  stop = (): void => {
    this.lifecycle += 1;
    this.send({ type: 'stop' });
    this.preferences.stop();
    this.assignmentState = transitionAssignments(this.assignmentState, { type: 'stop' }).state;
    this.opening = undefined;
  };

  reload = async (): Promise<void> => {
    if (this.model.synchronization.kind === 'inactive') return;
    const lifecycle = this.lifecycle;
    while (this.executing) await this.executing;
    if (lifecycle !== this.lifecycle) return;
    this.send({ type: 'open', mode: 'reload' });
    await this.opening;
  };

  refresh = async (): Promise<void> => {
    if (this.model.synchronization.kind === 'inactive') return;
    const lifecycle = this.lifecycle;
    await this.flush();
    if (lifecycle !== this.lifecycle || this.snapshot.hasUnsavedChanges) return;
    this.send({ type: 'open' });
    await this.opening;
  };

  dispatch = (action: WorkflowAction): void => {
    this.send({ type: 'dispatch', action });
  };

  restoreDraft = (taskId: TaskId, dispatch: (action: WorkflowAction) => void = this.dispatch): void => {
    const draft = this.model.drafts[taskId];
    if (
      !draft ||
      (this.snapshot.status !== 'saved' && this.snapshot.status !== 'saving') ||
      !workflowPermission(this.model, 'workflow.execute')
    )
      return;
    const action = restoreDraftAction(
      this.process,
      this.snapshot.state,
      loadedSynchronization(this.model)?.saved.authority,
      taskId,
      draft,
    );
    if (action) dispatch(action);
  };

  flush = async (): Promise<void> => {
    this.send({ type: 'flush' });
    while (this.executing) await this.executing;
  };

  savePreferences = (patch: WorkspacePreferences): Promise<void> => this.preferences.save(patch);
  retryPreferences = (): Promise<void> => this.preferences.retry();

  saveAssignments = async (input: AssignmentsInput): Promise<void> => {
    await this.flush();
    const saved = loadedSynchronization(this.model)?.saved;
    const transition = transitionAssignments(this.assignmentState, {
      type: 'save',
      input,
      saved,
      pendingChanges: this.snapshot.hasUnsavedChanges || this.model.synchronization.kind === 'inactive',
      available: Boolean(this.repository.saveAssignments),
    });
    this.assignmentState = transition.state;
    if (transition.rejected)
      throw new RequestError(
        transition.rejected,
        'Assignments could not be saved. Resolve pending workflow changes first.',
      );
    const effect = transition.effects[0];
    if (!effect) throw new RequestError('conflict', 'Assignments are already being saved.');
    try {
      const assignments = await this.repository.saveAssignments!(effect.id, effect.expectedVersion, effect.input);
      const next = transitionAssignments(this.assignmentState, { type: 'saved', request: effect.request, assignments });
      if (next.state === this.assignmentState)
        throw new RequestError('conflict', 'The workspace changed while assignments were being saved.');
      this.assignmentState = next.state;
      await this.refresh();
      if (this.snapshot.status === 'error')
        throw new RequestError('unknown', 'Assignments were saved but could not be refreshed.');
    } catch (error) {
      this.assignmentState = transitionAssignments(this.assignmentState, {
        type: 'failed',
        request: effect.request,
        error: errorKindOf(error),
      }).state;
      throw error;
    }
  };

  private publish(): void {
    this.snapshot = { ...workflowSessionSnapshot(this.model), preferenceError: this.preferences?.error };
    this.listeners.forEach((listener) => listener());
  }

  private send(event: WorkflowSessionEvent): void {
    const transition = transitionWorkflowSession(this.model, event, {
      process: this.process,
      ...(this.focus ? { focus: this.focus } : {}),
    });
    if (transition.state !== this.model) {
      this.model = transition.state;
      this.publish();
    }
    for (const effect of transition.effects) this.run(effect);
  }

  private run(effect: WorkflowSessionEffect): void {
    switch (effect.type) {
      case 'open':
        this.opening = this.load(effect.request);
        break;
      case 'execute': {
        const operation = this.execute(effect);
        this.executing = operation;
        void operation.then(() => {
          if (this.executing === operation) this.executing = undefined;
        });
        break;
      }
      case 'cancelFlush':
        this.cancelTimer?.();
        this.cancelTimer = undefined;
        break;
      case 'scheduleFlush':
        this.cancelTimer = this.scheduler.schedule(() => {
          this.cancelTimer = undefined;
          void this.flush();
        }, effect.delayMs);
        break;
      case 'savePreferences':
        void this.savePreferences(effect.patch);
        break;
    }
  }

  private async load(request: number): Promise<void> {
    try {
      const saved = await this.repository.open();
      this.send({ type: 'loaded', request, saved });
    } catch (error) {
      this.send({ type: 'loadFailed', request, error: String(error), errorKind: errorKindOf(error) });
    }
  }

  private async execute(effect: Extract<WorkflowSessionEffect, { type: 'execute' }>): Promise<void> {
    try {
      const saved = await this.repository.execute(effect.id, effect.version, effect.action);
      this.send({ type: 'executed', request: effect.request, saved });
    } catch (error) {
      this.send({
        type: 'executeFailed',
        request: effect.request,
        error: String(error),
        errorKind: errorKindOf(error),
      });
    }
    if (this.model.synchronization.kind === 'loading') await this.opening;
  }
}
