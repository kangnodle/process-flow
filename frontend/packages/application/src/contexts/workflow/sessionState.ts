import {
  createInitialState,
  type Permission,
  type PersistentAction,
  type Process,
  type StoredPreferences,
  type TaskId,
  type TaskRecord,
  type WorkflowAction,
  type WorkflowProgress,
  type WorkflowSelection,
  type WorkflowState,
} from '@process-flow/domain';
import type { RequestErrorKind } from '../../errors';
import type { SavedWorkflow, WorkflowFocus, WorkspacePreferences } from '../../ports';

export type CommandQueue = readonly [PersistentAction, ...PersistentAction[]];
export type LoadedSynchronization =
  | { readonly kind: 'ready'; readonly saved: SavedWorkflow }
  | { readonly kind: 'saving'; readonly saved: SavedWorkflow; readonly queue: CommandQueue; readonly sending?: number }
  | {
      readonly kind: 'saveFailed';
      readonly saved: SavedWorkflow;
      readonly queue: CommandQueue;
      readonly error: string;
    };
export type Synchronization =
  | LoadedSynchronization
  | {
      readonly kind: 'loading';
      readonly request: number;
      readonly previous?: LoadedSynchronization;
      readonly mode: 'open' | 'reload' | 'permissionLost';
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'inactive'; readonly previous?: LoadedSynchronization }
  | {
      readonly kind: 'loadFailed';
      readonly error: string;
      readonly errorKind: RequestErrorKind;
      readonly previous?: LoadedSynchronization;
    };

export interface WorkflowSessionState {
  readonly synchronization: Synchronization;
  readonly progress: WorkflowProgress;
  readonly selection: WorkflowSelection;
  readonly selectionChanges: Partial<WorkflowSelection>;
  readonly drafts: Readonly<Record<TaskId, TaskRecord>>;
  readonly sequence: number;
  readonly permissionLost?: boolean;
}

export interface WorkspaceIdentity {
  readonly id: string;
  readonly name?: string;
  readonly projectId?: string;
  readonly projectArchived?: boolean;
}

export interface WorkflowSessionContext {
  readonly process: Process;
  readonly focus?: WorkflowFocus;
}

export type WorkflowSessionEvent =
  | { readonly type: 'open'; readonly mode?: 'open' | 'reload' }
  | { readonly type: 'loaded'; readonly request: number; readonly saved: SavedWorkflow | undefined }
  | {
      readonly type: 'loadFailed';
      readonly request: number;
      readonly error: string;
      readonly errorKind: RequestErrorKind;
    }
  | { readonly type: 'dispatch'; readonly action: WorkflowAction }
  | { readonly type: 'flush' }
  | { readonly type: 'stop' }
  | { readonly type: 'executed'; readonly request: number; readonly saved: SavedWorkflow }
  | {
      readonly type: 'executeFailed';
      readonly request: number;
      readonly error: string;
      readonly errorKind: RequestErrorKind;
    };

export type WorkflowSessionEffect =
  | { readonly type: 'open'; readonly request: number }
  | {
      readonly type: 'execute';
      readonly request: number;
      readonly id: string;
      readonly version: number;
      readonly action: PersistentAction;
    }
  | { readonly type: 'scheduleFlush'; readonly delayMs: number }
  | { readonly type: 'cancelFlush' }
  | { readonly type: 'savePreferences'; readonly patch: WorkspacePreferences };

export interface WorkflowTransition {
  readonly state: WorkflowSessionState;
  readonly effects: readonly WorkflowSessionEffect[];
}

export function createWorkflowSessionState(process: Process): WorkflowSessionState {
  const { view, selectedTaskId, ...progress } = createInitialState(process);
  return {
    synchronization: { kind: 'loading', request: 0, mode: 'open' },
    progress,
    selection: { view, selectedTaskId },
    selectionChanges: {},
    drafts: {},
    sequence: 0,
  };
}

export function sessionWorkflow(model: WorkflowSessionState): WorkflowState {
  return { ...model.progress, ...model.selection };
}

export function withWorkflow(model: WorkflowSessionState, state: WorkflowState): WorkflowSessionState {
  const { view, selectedTaskId, ...progress } = state;
  const unchanged =
    progress.phase === model.progress.phase &&
    progress.rework === model.progress.rework &&
    progress.records === model.progress.records;
  return { ...model, progress: unchanged ? model.progress : progress, selection: { view, selectedTaskId } };
}

export function loadedSynchronization(state: WorkflowSessionState): LoadedSynchronization | undefined {
  const sync = state.synchronization;
  if (sync.kind === 'loading' || sync.kind === 'loadFailed' || sync.kind === 'inactive') return sync.previous;
  return sync.kind === 'ready' || sync.kind === 'saving' || sync.kind === 'saveFailed' ? sync : undefined;
}

export function workflowQueue(state: WorkflowSessionState): readonly PersistentAction[] {
  const sync = loadedSynchronization(state);
  return sync?.kind === 'saving' || sync?.kind === 'saveFailed' ? sync.queue : [];
}

export function workflowPermission(state: WorkflowSessionState, permission: Permission): boolean {
  return loadedSynchronization(state)?.saved.permissions?.includes(permission) ?? true;
}

export function workflowSessionSnapshot(model: WorkflowSessionState) {
  const sync = model.synchronization;
  const saved = loadedSynchronization(model)?.saved;
  const status =
    sync.kind === 'loading' || sync.kind === 'inactive'
      ? ('loading' as const)
      : sync.kind === 'empty'
        ? ('empty' as const)
        : sync.kind === 'ready'
          ? ('saved' as const)
          : sync.kind === 'saving'
            ? ('saving' as const)
            : ('error' as const);
  const preferences: Partial<StoredPreferences> | undefined =
    !saved?.preferencesLoadError && saved?.preferences
      ? {
          ...(saved.preferences.locale ? { locale: saved.preferences.locale } : {}),
          ...(saved.preferences.theme ? { theme: saved.preferences.theme } : {}),
        }
      : undefined;
  const workspace: WorkspaceIdentity | undefined = saved && {
    id: saved.id,
    ...(saved.name !== undefined ? { name: saved.name } : {}),
    ...(saved.projectId !== undefined ? { projectId: saved.projectId } : {}),
    ...(saved.projectArchived !== undefined ? { projectArchived: saved.projectArchived } : {}),
  };
  return {
    state: sessionWorkflow(model),
    status,
    error: sync.kind === 'loadFailed' || sync.kind === 'saveFailed' ? sync.error : undefined,
    openError: sync.kind === 'loadFailed' ? sync.errorKind : undefined,
    hasUnsavedChanges: workflowQueue(model).length > 0,
    readOnly: !workflowPermission(model, 'workflow.execute'),
    conflictedDrafts: Object.keys(model.drafts).length ? model.drafts : undefined,
    preferences,
    workspace,
    permissions: saved?.permissions,
    assignments: saved?.assignments,
    authority: saved?.authority,
    permissionLost: model.permissionLost,
    preferencesLoadError: saved?.preferencesLoadError,
  };
}
