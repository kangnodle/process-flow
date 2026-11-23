import { expect, it, vi } from 'vitest';
import { STANDARD_PROCESS, taskForm, createInitialState } from '@process-flow/domain';
import { WorkflowSession } from './workflowSession';
import { RequestError, type SavedWorkflow, type Scheduler, type WorkflowRepository } from '@process-flow/application';

const documentReadyState = () => ({
  ...createInitialState(STANDARD_PROCESS),
  records: Object.fromEntries(
    STANDARD_PROCESS.tasks.map((task) => [
      task.id,
      {
        link: '',
        note: '',
        document: {
          version: 1 as const,
          reviewStatus: 'passed' as const,
          answers: Object.fromEntries(
            taskForm(task.id).map((field) => [field.id, `Verified ${field.id} with the project team.`]),
          ),
        },
      },
    ]),
  ),
});

const timers: Scheduler = {
  schedule(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};
const createSession = (repository: WorkflowRepository) => new WorkflowSession(STANDARD_PROCESS, repository, timers);

it('retains failed preferences for an explicit retry without blocking progress', async () => {
  let offline = true;
  let persisted = {};
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: async () => stored,
    execute: vi.fn(),
    savePreferences: async (_id, patch) => {
      if (offline) throw new Error('offline');
      persisted = patch;
      return patch;
    },
  });
  await session.open();
  await session.savePreferences({ locale: 'en', theme: 'dark' });
  expect(session.getSnapshot()).toMatchObject({ status: 'saved', preferenceError: 'Error: offline' });
  offline = false;
  await session.retryPreferences();
  expect(persisted).toEqual({ locale: 'en', theme: 'dark' });
  expect(session.getSnapshot().preferenceError).toBeUndefined();
});

it('turns a synchronous port failure into a failed save and keeps the draft', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: async () => stored,
    execute: () => {
      throw new Error('transport setup failed');
    },
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'retain me' } });
  await expect(session.flush()).resolves.toBeUndefined();
  expect(session.getSnapshot()).toMatchObject({ status: 'error', hasUnsavedChanges: true });
  expect(session.getSnapshot().state.records.goals?.note).toBe('retain me');
});

it('preserves loaded preferences when a command response omits presentation settings', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: async () => ({ ...stored, preferences: { locale: 'en', theme: 'dark' } }),
    execute: async () => ({ ...stored, version: 1 }),
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'edit' } });
  await session.flush();
  expect(session.getSnapshot().preferences).toEqual({ locale: 'en', theme: 'dark' });
});

it('stops timers and queued commands when the session is no longer mounted', async () => {
  let release!: (saved: SavedWorkflow) => void;
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi.fn<WorkflowRepository['execute']>(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const cancel = vi.fn();
  const session = new WorkflowSession(
    STANDARD_PROCESS,
    { open: async () => stored, execute },
    { schedule: () => cancel },
  );
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'first' } });
  const pending = session.flush();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'later' } });
  session.stop();
  release({ ...stored, version: 1 });
  await pending;
  expect(execute).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalled();
  expect(session.getSnapshot().state.records.goals?.note).toBe('later');
});

it('never resumes a stopped session through reload or a delayed refresh', async () => {
  let release!: (saved: SavedWorkflow) => void;
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const open = vi.fn(async () => stored);
  const session = createSession({
    open,
    execute: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'pending' } });
  const pendingRefresh = session.refresh();
  session.stop();
  release({ ...stored, version: 1 });
  await pendingRefresh;
  await session.reload();
  expect(open).toHaveBeenCalledTimes(1);
});

it('rejects assignment saving when pending workflow changes could not be persisted', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const saveAssignments = vi.fn();
  const session = createSession({
    open: async () => stored,
    execute: async () => {
      throw new Error('offline');
    },
    saveAssignments,
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'unsaved' } });
  await expect(session.saveAssignments({ stages: [], tasks: [] })).rejects.toMatchObject({ kind: 'conflict' });
  expect(saveAssignments).not.toHaveBeenCalled();
});

it('exposes synchronous preference failures and permits retry', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: async () => stored,
    execute: vi.fn(),
    savePreferences: () => {
      throw new Error('offline');
    },
  });
  await session.open();
  await expect(session.savePreferences({ locale: 'en' })).resolves.toBeUndefined();
  expect(session.getSnapshot().preferenceError).toBe('Error: offline');
});

it('keeps a preference patch retryable when its workspace temporarily disappears', async () => {
  let available = true;
  let offline = true;
  let persisted = {};
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: async () => (available ? stored : undefined),
    execute: vi.fn(),
    savePreferences: async (_id, patch) => {
      if (offline) throw new Error('offline');
      persisted = patch;
      return patch;
    },
  });
  await session.open();
  await session.savePreferences({ locale: 'en' });
  available = false;
  await session.reload();
  await session.retryPreferences();
  expect(session.getSnapshot().preferenceError).toBeDefined();
  available = true;
  offline = false;
  await session.reload();
  await session.retryPreferences();
  expect(persisted).toEqual({ locale: 'en' });
  expect(session.getSnapshot().preferenceError).toBeUndefined();
});

it('never submits queued preferences after the originating session stops', async () => {
  let release!: () => void;
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const savePreferences = vi.fn<NonNullable<WorkflowRepository['savePreferences']>>(
    () =>
      new Promise((resolve) => {
        release = () => resolve({});
      }),
  );
  const session = createSession({ open: async () => stored, execute: vi.fn(), savePreferences });
  await session.open();
  const first = session.savePreferences({ locale: 'en' });
  const second = session.savePreferences({ theme: 'dark' });
  session.stop();
  release();
  await Promise.all([first, second]);
  expect(savePreferences).toHaveBeenCalledTimes(1);
});

it('does not let a late refresh replace a newer reload', async () => {
  let load = 0;
  let old!: (saved: SavedWorkflow) => void;
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const session = createSession({
    open: () => {
      load += 1;
      if (load === 2)
        return new Promise((resolve) => {
          old = resolve;
        });
      return Promise.resolve({ ...stored, version: load });
    },
    execute: vi.fn(),
  });
  await session.open();
  const refresh = session.refresh();
  await Promise.resolve();
  const reload = session.reload();
  await reload;
  old({ ...stored, version: 2, state: { ...stored.state, records: {} } });
  await refresh;
  expect(session.getSnapshot().state.records.goals?.document?.reviewStatus).toBe('passed');
});

it('직렬 저장하고 새 세션에서 작업·단계·기록을 복원한다', async () => {
  let stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi.fn<WorkflowRepository['execute']>(async (_id, version, action) => {
    expect(version).toBe(stored.version);
    const { createWorkflowReducer } = await import('@process-flow/domain');
    stored = { ...stored, version: version + 1, state: createWorkflowReducer(STANDARD_PROCESS)(stored.state, action) };
    return stored;
  });
  const repository: WorkflowRepository = { open: async () => stored, execute };
  const session = createSession(repository);
  await Promise.all([session.open(), session.open()]);
  session.dispatch({
    type: 'updateRecord',
    taskId: 'goals',
    patch: { note: 'memo', link: 'https://example.com', document: stored.state.records.goals!.document! },
  });
  await session.flush();
  for (const task of STANDARD_PROCESS.stages[0]!.tasks) session.dispatch({ type: 'completeTask', taskId: task.id });
  session.dispatch({ type: 'approveStage', stageIndex: 0 });
  await session.flush();
  expect(session.getSnapshot().status).toBe('saved');
  const restored = createSession(repository);
  await restored.open();
  expect(restored.getSnapshot().state.phase).toEqual({ kind: 'working', stageIndex: 1, completed: 0 });
  expect(restored.getSnapshot().state.records.goals?.note).toBe('memo');
});
it('실패한 완료 명령을 자동 재시도하지 않고 재조회 후 편집을 재개한다', async () => {
  const stored = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi.fn().mockRejectedValue(new Error('conflict'));
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  session.dispatch({ type: 'completeTask', taskId: 'goals' });
  await session.flush();
  expect(session.getSnapshot().status).toBe('error');
  session.dispatch({ type: 'reopenTask', taskId: 'goals' });
  expect(execute).toHaveBeenCalledTimes(1);
  await session.reload();
  expect(session.getSnapshot().state.phase).toEqual({ kind: 'working', stageIndex: 0, completed: 0 });
});

it('저장 응답이 늦어도 새 입력과 사용자가 선택한 작업을 보존한다', async () => {
  const initial = { id: 'one', version: 0, state: documentReadyState() };
  let release!: (value: SavedWorkflow) => void;
  const execute = vi
    .fn<WorkflowRepository['execute']>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockImplementation(async (_id, version, command) => {
      const { createWorkflowReducer } = await import('@process-flow/domain');
      return {
        ...initial,
        version: version + 1,
        state: createWorkflowReducer(STANDARD_PROCESS)(initial.state, command),
      };
    });
  const session = createSession({ open: async () => initial, execute });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'first' } });
  const flush = session.flush();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'newest' } });
  session.dispatch({ type: 'selectTask', taskId: 'user-research' });
  release({ ...initial, version: 1, state: { ...initial.state, records: { goals: { link: '', note: 'first' } } } });
  await flush;
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute.mock.calls[1]?.[1]).toBe(1);
  expect(session.getSnapshot().state.records.goals?.note).toBe('newest');
  expect(session.getSnapshot().state.selectedTaskId).toBe('user-research');
});

it('저장된 뷰·작업과 언어·테마를 열 때 복원하고, 뷰·작업 변경은 합쳐서 순서대로 저장한다', async () => {
  const stored: SavedWorkflow = {
    id: 'one',
    version: 0,
    state: documentReadyState(),
    preferences: { locale: 'en', theme: 'dark', view: 'board', selectedTaskId: 'user-research' },
  };
  let release!: () => void;
  const savePreferences = vi
    .fn<NonNullable<WorkflowRepository['savePreferences']>>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({});
        }),
    )
    .mockResolvedValue({});
  const session = createSession({
    open: async () => stored,
    execute: vi.fn(),
    savePreferences,
  });
  await session.open();
  const { state, preferences } = session.getSnapshot();
  expect(state.view).toBe('board');
  expect(state.selectedTaskId).toBe('user-research');
  expect(preferences).toEqual({ locale: 'en', theme: 'dark' });

  session.dispatch({ type: 'setView', view: 'stage' });
  session.dispatch({ type: 'selectTask', taskId: 'goals', view: 'task' });
  session.dispatch({ type: 'setView', view: 'task' });
  const done = session.savePreferences({ locale: 'ko' });
  release();
  await done;
  expect(savePreferences.mock.calls).toEqual([
    ['one', { view: 'stage' }],
    ['one', { view: 'task', selectedTaskId: 'goals', locale: 'ko' }],
  ]);
});

it('공정에 없는 저장된 작업은 무시하고, 설정 저장 실패는 편집을 막지 않는다', async () => {
  const stored: SavedWorkflow = {
    id: 'one',
    version: 0,
    state: documentReadyState(),
    preferences: { selectedTaskId: 'removed-task' },
  };
  const savePreferences = vi.fn().mockRejectedValue(new Error('offline'));
  const session = createSession({
    open: async () => stored,
    execute: vi.fn(),
    savePreferences,
  });
  await session.open();
  expect(session.getSnapshot().state.selectedTaskId).toBe(stored.state.selectedTaskId);
  session.dispatch({ type: 'setView', view: 'board' });
  await session.savePreferences({});
  expect(session.getSnapshot().status).toBe('saved');
  expect(session.getSnapshot().state.view).toBe('board');
});

it('진행 명령이 선택 작업을 바꾸면 그 선택도 저장한다', async () => {
  const { createWorkflowReducer } = await import('@process-flow/domain');
  let stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const savePreferences = vi.fn<NonNullable<WorkflowRepository['savePreferences']>>().mockResolvedValue({});
  const session = createSession({
    open: async () => stored,
    execute: async (_id, version, action) => {
      stored = {
        ...stored,
        version: version + 1,
        state: createWorkflowReducer(STANDARD_PROCESS)(stored.state, action),
      };
      return stored;
    },
    savePreferences,
  });
  await session.open();
  for (const task of STANDARD_PROCESS.stages[0]!.tasks) session.dispatch({ type: 'completeTask', taskId: task.id });
  session.dispatch({ type: 'approveStage', stageIndex: 0 });
  await Promise.all([session.flush(), session.savePreferences({})]);
  const next = STANDARD_PROCESS.stages[1]!.tasks[0]!.id;
  expect(session.getSnapshot().state.selectedTaskId).toBe(next);
  expect(savePreferences).toHaveBeenLastCalledWith('one', expect.objectContaining({ selectedTaskId: next }));
});

it('열지 못한 워크플로는 오류여도 잃을 변경이 없고, 없는 ID면 notFound로 알린다', async () => {
  const execute = vi.fn<WorkflowRepository['execute']>();
  const session = createSession({
    open: () => Promise.reject(new RequestError('notFound', 'HTTP 404')),
    execute,
  });
  await session.open();
  expect(session.getSnapshot()).toMatchObject({ status: 'error', openError: 'notFound', hasUnsavedChanges: false });
  session.dispatch({ type: 'completeTask', taskId: 'goals' });
  expect(session.getSnapshot().hasUnsavedChanges).toBe(false);
  expect(execute).not.toHaveBeenCalled();
});
it('저장에 실패한 명령은 확인받지 못한 변경으로 남고, 다시 불러오면 사라진다', async () => {
  const stored = { id: 'one', version: 0, state: documentReadyState() };
  let release!: () => void;
  const execute = vi.fn<WorkflowRepository['execute']>(
    () =>
      new Promise((_resolve, reject) => {
        release = () => reject(new Error('HTTP 409'));
      }),
  );
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  expect(session.getSnapshot().hasUnsavedChanges).toBe(false);
  session.dispatch({ type: 'completeTask', taskId: 'goals' });
  expect(session.getSnapshot().hasUnsavedChanges).toBe(true);
  release();
  await session.flush();
  expect(session.getSnapshot()).toMatchObject({ status: 'error', hasUnsavedChanges: true });
  expect(session.getSnapshot().openError).toBeUndefined();
  await session.reload();
  expect(session.getSnapshot()).toMatchObject({ status: 'saved', hasUnsavedChanges: false });
});

it('preserves document and evidence drafts across failed saves and version refreshes', async () => {
  const document = {
    version: 1 as const,
    answers: { problem: 'Customer support cannot track requests' },
    reviewStatus: 'pending' as const,
  };
  let stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi
    .fn<WorkflowRepository['execute']>()
    .mockRejectedValue(new RequestError('versionConflict', 'stale'));
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  session.dispatch({
    type: 'updateRecord',
    taskId: 'goals',
    patch: {
      document,
      evidence: [{ id: 'report', kind: 'link', title: 'Report', description: 'Research', url: 'https://example.com' }],
    },
  });
  await session.flush();
  expect(session.getSnapshot().state.records.goals?.document).toEqual(document);
  stored = { ...stored, version: 3 };
  await session.reload();
  expect(session.getSnapshot().state.records.goals).toEqual(stored.state.records.goals);
  expect(session.getSnapshot().conflictedDrafts?.goals?.document).toEqual(document);
  expect(session.getSnapshot().conflictedDrafts?.goals?.evidence).toHaveLength(1);
  expect(session.getSnapshot()).toMatchObject({ status: 'saved', hasUnsavedChanges: false });
  expect(execute).toHaveBeenCalledTimes(1);
  session.restoreDraft('goals');
  expect(session.getSnapshot().state.records.goals?.document).toEqual(document);
  await session.flush();
  expect(session.getSnapshot().conflictedDrafts?.goals?.document).toEqual(document);
});

it('waits for persistence before completion and retains a failed draft after permission loss', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi
    .fn<WorkflowRepository['execute']>()
    .mockRejectedValue(new RequestError('forbidden', 'Permission changed'));
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  session.dispatch({
    type: 'updateRecord',
    taskId: 'goals',
    patch: { document: stored.state.records.goals!.document!, note: 'Unsaved research' },
  });
  session.dispatch({ type: 'completeTask', taskId: 'goals' });
  expect(session.getSnapshot().state.phase).toEqual({ kind: 'working', stageIndex: 0, completed: 0 });
  await session.flush();
  expect(session.getSnapshot().state.records.goals?.note).toBe('Unsaved research');
  expect(session.getSnapshot()).toMatchObject({ status: 'error', hasUnsavedChanges: true });
});

it('archives a conflicting draft, exposes completed remote work, and restores only after reopen', async () => {
  const { createWorkflowReducer } = await import('@process-flow/domain');
  const reduce = createWorkflowReducer(STANDARD_PROCESS);
  let stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  let fail = true;
  const execute = vi.fn<WorkflowRepository['execute']>(async (_id, version, action) => {
    if (fail) throw new Error('conflict');
    expect(version).toBe(stored.version);
    stored = { ...stored, version: version + 1, state: reduce(stored.state, action) };
    return stored;
  });
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'Local research' } });
  await session.flush();
  stored = { ...stored, version: 2, state: reduce(stored.state, { type: 'completeTask', taskId: 'goals' }) };
  await session.reload();
  expect(session.getSnapshot().state.phase).toEqual({ kind: 'working', stageIndex: 0, completed: 1 });
  expect(session.getSnapshot().state.records.goals?.note).toBe('');
  expect(session.getSnapshot().conflictedDrafts?.goals?.note).toBe('Local research');
  session.restoreDraft('goals');
  expect(session.getSnapshot().state.records.goals?.note).toBe('');
  fail = false;
  session.dispatch({ type: 'reopenTask', taskId: 'goals' });
  await session.flush();
  session.restoreDraft('goals');
  await session.flush();
  expect(stored.state.records.goals?.note).toBe('Local research');
  expect(stored.state.records.goals?.document?.reviewStatus).toBe('pending');
  expect(session.getSnapshot().status).toBe('saved');
  expect(session.getSnapshot().conflictedDrafts?.goals).toBeUndefined();
});

it('keeps concurrent remote edits on reload until an explicit draft restore', async () => {
  let stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  const execute = vi.fn<WorkflowRepository['execute']>().mockRejectedValue(new Error('conflict'));
  const session = createSession({ open: async () => stored, execute });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'Local decision' } });
  await session.flush();
  stored = {
    ...stored,
    version: 4,
    state: {
      ...stored.state,
      records: { ...stored.state.records, goals: { ...stored.state.records.goals!, note: 'Remote decision' } },
    },
  };
  await session.reload();
  await session.flush();
  expect(session.getSnapshot().state.records.goals?.note).toBe('Remote decision');
  expect(session.getSnapshot().conflictedDrafts?.goals?.note).toBe('Local decision');
  expect(execute).toHaveBeenCalledTimes(1);
  await session.reload();
  expect(session.getSnapshot().conflictedDrafts?.goals?.note).toBe('Local decision');
});

it('leaves a local draft and failed queue untouched if reload fails', async () => {
  const stored: SavedWorkflow = { id: 'one', version: 0, state: documentReadyState() };
  let offline = false;
  const session = createSession({
    open: async () => {
      if (offline) throw new Error('offline');
      return stored;
    },
    execute: async () => {
      throw new Error('conflict');
    },
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'Must survive' } });
  await session.flush();
  offline = true;
  await session.reload();
  expect(session.getSnapshot().state.records.goals?.note).toBe('Must survive');
  expect(session.getSnapshot()).toMatchObject({ status: 'error', hasUnsavedChanges: true });
  expect(session.getSnapshot().conflictedDrafts).toBeUndefined();
});

it('archives an intentional blank record and respects refreshed execution rights when restoring', async () => {
  let stored: SavedWorkflow = {
    id: 'one',
    version: 0,
    state: { ...createInitialState(STANDARD_PROCESS), records: { goals: { link: '', note: 'Old note' } } },
  };
  const session = createSession({
    open: async () => stored,
    execute: async () => {
      throw new Error('conflict');
    },
  });
  await session.open();
  session.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: '' } });
  await session.flush();
  stored = { ...stored, version: 1, permissions: ['project.view'] };
  await session.reload();
  expect(session.getSnapshot().conflictedDrafts?.goals).toEqual({ link: '', note: '' });
  session.restoreDraft('goals');
  expect(session.getSnapshot().state.records.goals?.note).toBe('Old note');
  expect(session.getSnapshot()).toMatchObject({ status: 'saved', readOnly: true, hasUnsavedChanges: false });
});
