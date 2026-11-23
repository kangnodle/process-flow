import { createInitialState, createWorkflowReducer } from '@process-flow/domain';
import { acknowledgeWorkflowDraft, collectWorkflowDrafts } from '../../workflow/workflowDrafts';
import {
  canDispatchWorkflowAction,
  enqueueWorkflowAction,
  reconcileWorkflowState,
  restoreWorkflowView,
  workflowViewChanges,
} from '../../workflow/workflowPolicy';
import {
  loadedSynchronization,
  sessionWorkflow,
  withWorkflow,
  workflowPermission,
  workflowQueue,
  workflowSessionSnapshot,
  type CommandQueue,
  type WorkflowSessionContext,
  type WorkflowSessionEffect,
  type WorkflowSessionEvent,
  type WorkflowSessionState,
  type WorkflowTransition,
} from './sessionState';

export * from './sessionState';

function beginCommand(model: WorkflowSessionState): WorkflowTransition {
  const sync = model.synchronization;
  if (sync.kind !== 'saving' || sync.sending !== undefined) return { state: model, effects: [] };
  const request = model.sequence + 1;
  return {
    state: { ...model, sequence: request, synchronization: { ...sync, sending: request } },
    effects: [{ type: 'execute', request, id: sync.saved.id, version: sync.saved.version, action: sync.queue[0] }],
  };
}

function openWorkflow(model: WorkflowSessionState, mode: 'open' | 'reload' | 'permissionLost'): WorkflowTransition {
  const request = model.sequence + 1;
  const previous = loadedSynchronization(model);
  return {
    state: {
      ...model,
      sequence: request,
      synchronization: { kind: 'loading', request, mode, ...(previous ? { previous } : {}) },
    },
    effects: [{ type: 'cancelFlush' }, { type: 'open', request }],
  };
}

function acceptLoad(
  model: WorkflowSessionState,
  event: Extract<WorkflowSessionEvent, { type: 'loaded' }>,
  context: WorkflowSessionContext,
): WorkflowTransition {
  const sync = model.synchronization;
  if (sync.kind !== 'loading' || sync.request !== event.request) return { state: model, effects: [] };
  const current = sessionWorkflow(model);
  const drafts =
    sync.mode === 'reload'
      ? { ...model.drafts, ...collectWorkflowDrafts(current, workflowQueue(model)) }
      : model.drafts;
  if (!event.saved)
    return {
      state: withWorkflow(
        { ...model, drafts, synchronization: { kind: 'empty' } },
        createInitialState(context.process),
      ),
      effects: [],
    };
  const saved = event.saved;
  const reopened = sync.previous?.saved.id === saved.id;
  const recoveredPreferences = reopened && sync.previous?.saved.preferencesLoadError && !saved.preferencesLoadError;
  const focus = context.focus ? { selectedTaskId: context.focus.taskId, view: context.focus.view } : {};
  const state = recoveredPreferences
    ? restoreWorkflowView(context.process, saved.state, { ...saved.preferences, ...focus, ...model.selectionChanges })
    : reopened
      ? { ...saved.state, ...model.selection }
      : restoreWorkflowView(context.process, saved.state, { ...saved.preferences, ...focus });
  return {
    state: withWorkflow(
      {
        ...model,
        drafts,
        selectionChanges: reopened ? model.selectionChanges : {},
        synchronization: { kind: 'ready', saved },
        ...(sync.mode === 'permissionLost' ? { permissionLost: true } : {}),
      },
      state,
    ),
    effects: [],
  };
}

function dispatchWorkflow(
  model: WorkflowSessionState,
  event: Extract<WorkflowSessionEvent, { type: 'dispatch' }>,
  context: WorkflowSessionContext,
): WorkflowTransition {
  const sync = model.synchronization;
  const loaded = loadedSynchronization(model);
  const queue = workflowQueue(model);
  const { action } = event;
  if (
    !canDispatchWorkflowAction(
      context.process,
      action,
      workflowSessionSnapshot(model).status,
      workflowPermission(model, 'workflow.execute'),
      loaded?.saved.authority,
      queue,
    )
  )
    return { state: model, effects: [] };
  const current = sessionWorkflow(model);
  const state = createWorkflowReducer(context.process)(current, action);
  if (state === current) return { state: model, effects: [] };
  const patch = workflowViewChanges(current, state);
  const changed = { ...model, selectionChanges: { ...model.selectionChanges, ...patch } };
  const preferences: readonly WorkflowSessionEffect[] = Object.keys(patch).length
    ? [{ type: 'savePreferences', patch }]
    : [];
  if (action.type === 'setView' || action.type === 'selectTask')
    return { state: withWorkflow(changed, state), effects: preferences };
  if (!loaded || (sync.kind !== 'ready' && sync.kind !== 'saving')) return { state: model, effects: [] };
  const [first, ...rest] = enqueueWorkflowAction(queue, action, sync.kind === 'saving' && sync.sending !== undefined);
  const nextQueue: CommandQueue = [first!, ...rest];
  const next = withWorkflow(
    {
      ...changed,
      synchronization: {
        kind: 'saving',
        saved: loaded.saved,
        queue: nextQueue,
        ...(sync.kind === 'saving' && sync.sending !== undefined ? { sending: sync.sending } : {}),
      },
    },
    state,
  );
  if (action.type === 'updateRecord')
    return { state: next, effects: [...preferences, { type: 'cancelFlush' }, { type: 'scheduleFlush', delayMs: 500 }] };
  const started = beginCommand(next);
  return { ...started, effects: [...preferences, { type: 'cancelFlush' }, ...started.effects] };
}

export function transitionWorkflowSession(
  model: WorkflowSessionState,
  event: WorkflowSessionEvent,
  context: WorkflowSessionContext,
): WorkflowTransition {
  const sync = model.synchronization;
  switch (event.type) {
    case 'open':
      return openWorkflow(
        model,
        event.mode ?? (sync.kind === 'inactive' && workflowQueue(model).length ? 'reload' : 'open'),
      );
    case 'stop': {
      const previous = loadedSynchronization(model);
      return {
        state: {
          ...model,
          sequence: model.sequence + 1,
          synchronization: { kind: 'inactive', ...(previous ? { previous } : {}) },
        },
        effects: [{ type: 'cancelFlush' }],
      };
    }
    case 'loaded':
      return acceptLoad(model, event, context);
    case 'loadFailed': {
      if (sync.kind !== 'loading' || sync.request !== event.request) return { state: model, effects: [] };
      const previous = sync.previous;
      const synchronization =
        previous && previous.kind !== 'ready'
          ? { kind: 'saveFailed' as const, saved: previous.saved, queue: previous.queue, error: event.error }
          : {
              kind: 'loadFailed' as const,
              error: event.error,
              errorKind: event.errorKind,
              ...(previous ? { previous } : {}),
            };
      return { state: { ...model, synchronization }, effects: [] };
    }
    case 'dispatch':
      return dispatchWorkflow(model, event, context);
    case 'flush': {
      const next = beginCommand(model);
      return { ...next, effects: [{ type: 'cancelFlush' }, ...next.effects] };
    }
    case 'executed': {
      if (sync.kind !== 'saving' || sync.sending !== event.request) return { state: model, effects: [] };
      const saved = {
        ...event.saved,
        ...((event.saved.preferences ?? sync.saved.preferences)
          ? { preferences: event.saved.preferences ?? sync.saved.preferences }
          : {}),
        ...(sync.saved.preferencesLoadError ? { preferencesLoadError: sync.saved.preferencesLoadError } : {}),
      };
      const queue = sync.queue.slice(1);
      const state = reconcileWorkflowState(
        saved.state,
        sessionWorkflow(model),
        queue,
        createWorkflowReducer(context.process),
      );
      const drafts = acknowledgeWorkflowDraft(model.drafts, saved.state, sync.queue[0]);
      const [first, ...rest] = queue;
      const synchronization = first
        ? { kind: 'saving' as const, saved, queue: [first, ...rest] as CommandQueue }
        : { kind: 'ready' as const, saved };
      return beginCommand(withWorkflow({ ...model, drafts, synchronization }, state));
    }
    case 'executeFailed': {
      if (sync.kind !== 'saving' || sync.sending !== event.request) return { state: model, effects: [] };
      if (event.errorKind === 'forbidden' && !sync.queue.some((action) => action.type === 'updateRecord'))
        return openWorkflow({ ...model, synchronization: { kind: 'ready', saved: sync.saved } }, 'permissionLost');
      const error =
        event.errorKind === 'forbidden' ? 'Permission changed. Your unsaved draft is preserved.' : event.error;
      return {
        state: { ...model, synchronization: { kind: 'saveFailed', saved: sync.saved, queue: sync.queue, error } },
        effects: [],
      };
    }
  }
}
