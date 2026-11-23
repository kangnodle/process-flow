import { expect, it } from 'vitest';
import { createInitialState, STANDARD_PROCESS } from '@process-flow/domain';
import { createWorkflowSessionState, transitionWorkflowSession, workflowSessionSnapshot } from './sessionMachine';

const context = { process: STANDARD_PROCESS };
const saved = { id: 'one', version: 0, state: createInitialState(STANDARD_PROCESS) };

it('changes presentation selection without changing workflow progress data', () => {
  const initial = transitionWorkflowSession(createWorkflowSessionState(STANDARD_PROCESS), { type: 'open' }, context);
  const loaded = transitionWorkflowSession(initial.state, { type: 'loaded', request: 1, saved }, context);
  const selected = transitionWorkflowSession(
    loaded.state,
    { type: 'dispatch', action: { type: 'selectTask', taskId: 'user-research', view: 'task' } },
    context,
  );
  expect(selected.state.selection).toEqual({ view: 'task', selectedTaskId: 'user-research' });
  expect(selected.state.progress).toBe(loaded.state.progress);
  expect(selected.effects).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'execute' })]));
});

it('recovers untouched task preferences while preserving an explicitly chosen view', () => {
  const initial = transitionWorkflowSession(createWorkflowSessionState(STANDARD_PROCESS), { type: 'open' }, context);
  const loaded = transitionWorkflowSession(
    initial.state,
    { type: 'loaded', request: 1, saved: { ...saved, preferences: {}, preferencesLoadError: 'unknown' } },
    context,
  );
  const selected = transitionWorkflowSession(
    loaded.state,
    { type: 'dispatch', action: { type: 'setView', view: 'stage' } },
    context,
  );
  const retry = transitionWorkflowSession(selected.state, { type: 'open' }, context);
  const recovered = transitionWorkflowSession(
    retry.state,
    { type: 'loaded', request: 2, saved: { ...saved, preferences: { view: 'task', selectedTaskId: 'user-research' } } },
    context,
  );
  expect(recovered.state.selection).toEqual({ view: 'stage', selectedTaskId: 'user-research' });
});

it('ignores a stale load while preserving the latest requested workspace', () => {
  const initial = createWorkflowSessionState(STANDARD_PROCESS);
  const first = transitionWorkflowSession(initial, { type: 'open' }, context);
  const second = transitionWorkflowSession(first.state, { type: 'open' }, context);
  const stale = transitionWorkflowSession(second.state, { type: 'loaded', request: 1, saved }, context);
  expect(stale.state).toBe(second.state);
  const current = transitionWorkflowSession(
    stale.state,
    { type: 'loaded', request: 2, saved: { ...saved, id: 'two' } },
    context,
  );
  expect(workflowSessionSnapshot(current.state).workspace?.id).toBe('two');
  expect(initial.synchronization.kind).toBe('loading');
});

it('keeps a sent record separate from later edits and reconciles the latest selection', () => {
  const initial = transitionWorkflowSession(createWorkflowSessionState(STANDARD_PROCESS), { type: 'open' }, context);
  const opened = transitionWorkflowSession(initial.state, { type: 'loaded', request: 1, saved }, context);
  const edited = transitionWorkflowSession(
    opened.state,
    { type: 'dispatch', action: { type: 'updateRecord', taskId: 'goals', patch: { note: 'first' } } },
    context,
  );
  const sending = transitionWorkflowSession(edited.state, { type: 'flush' }, context);
  expect(sending.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'execute',
        request: 2,
        version: 0,
        action: expect.objectContaining({ patch: { note: 'first' } }),
      }),
    ]),
  );
  const latest = transitionWorkflowSession(
    sending.state,
    { type: 'dispatch', action: { type: 'updateRecord', taskId: 'goals', patch: { note: 'second' } } },
    context,
  );
  const acknowledged = transitionWorkflowSession(
    latest.state,
    {
      type: 'executed',
      request: 2,
      saved: { ...saved, version: 1, state: { ...saved.state, records: { goals: { link: '', note: 'first' } } } },
    },
    context,
  );
  expect(workflowSessionSnapshot(acknowledged.state).state.records.goals?.note).toBe('second');
  expect(acknowledged.effects).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'execute',
        version: 1,
        action: expect.objectContaining({ patch: { note: 'second' } }),
      }),
    ]),
  );
  expect(saved.state.records).toEqual({});
});

it('retains a failed command without retrying it when flush is requested again', () => {
  const initial = transitionWorkflowSession(createWorkflowSessionState(STANDARD_PROCESS), { type: 'open' }, context);
  const opened = transitionWorkflowSession(initial.state, { type: 'loaded', request: 1, saved }, context);
  const edited = transitionWorkflowSession(
    opened.state,
    { type: 'dispatch', action: { type: 'updateRecord', taskId: 'goals', patch: { note: 'draft' } } },
    context,
  );
  const sending = transitionWorkflowSession(edited.state, { type: 'flush' }, context);
  const failed = transitionWorkflowSession(
    sending.state,
    { type: 'executeFailed', request: 2, error: 'offline', errorKind: 'unknown' },
    context,
  );
  expect(workflowSessionSnapshot(failed.state)).toMatchObject({ status: 'error', hasUnsavedChanges: true });
  expect(transitionWorkflowSession(failed.state, { type: 'flush' }, context).effects).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: 'execute' })]),
  );
});
