import { expect, it, vi } from 'vitest';
import { createWorkflowRepository } from './workflowRepository';

const dto = {
  id: 'saved',
  processId: 'standard',
  version: 2,
  unlockedStage: 0,
  done: ['goals'],
  phase: { kind: 'working', stageIndex: 0, completed: 1 },
  records: { goals: { note: 'memo', link: '' } },
};
const respond = (body: unknown) => async () => new Response(JSON.stringify(body));
it('keeps a newer workflow identity when an older open finishes late', async () => {
  let release!: (response: Response) => void;
  let identity = 'old';
  const request = vi.fn<typeof fetch>((input) =>
    String(input) === '/api/v1/workflows/old'
      ? new Promise((resolve) => {
          release = resolve;
        })
      : Promise.resolve(
          new Response(JSON.stringify(String(input).endsWith('/preferences') ? {} : { ...dto, id: 'new' })),
        ),
  );
  const repository = createWorkflowRepository(
    {
      load: () => identity,
      save: (id) => {
        identity = id;
      },
    },
    request,
  );
  const old = repository.open();
  repository.switchTo?.('new');
  const current = repository.open();
  release(new Response(JSON.stringify({ ...dto, id: 'old' })));
  const [, latest] = await Promise.all([old, current]);
  expect(latest?.id).toBe('new');
  expect(identity).toBe('new');
});
it('저장된 ID를 조회하고 진행 위치를 복원한다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond(dto))
    .mockImplementationOnce(respond({ locale: 'en', theme: 'neon', view: 'board', selectedTaskId: 'goals' }));
  const save = vi.fn();
  const repository = createWorkflowRepository({ load: () => 'saved', save }, request);
  const result = await repository.open();
  expect(request).toHaveBeenCalledWith('/api/v1/workflows/saved', {});
  expect(result?.state.phase).toEqual({ kind: 'working', stageIndex: 0, completed: 1 });
  expect(result?.state.records.goals?.note).toBe('memo');
  expect(save).toHaveBeenCalledWith('saved');
  expect(request).toHaveBeenLastCalledWith('/api/v1/workflows/saved/preferences', {});
  expect(result?.preferences).toEqual({ locale: 'en', view: 'board', selectedTaskId: 'goals' });
});
it('화면 설정을 못 불러와도 워크플로를 연다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond(dto))
    .mockResolvedValueOnce(new Response('', { status: 500 }));
  const result = await createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request).open();
  expect(result?.preferences).toEqual({});
  expect(result?.preferencesLoadError).toBe('unknown');
  expect(result?.state.phase).toEqual({ kind: 'working', stageIndex: 0, completed: 1 });
});
it('화면 설정의 바뀐 항목만 PATCH로 보낸다', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(respond({ view: 'task', locale: null }));
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request);
  await expect(repository.savePreferences?.('saved', { view: 'task' })).resolves.toEqual({ view: 'task' });
  expect(request).toHaveBeenCalledWith('/api/v1/workflows/saved/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view: 'task' }),
  });
});
it('기억하던 ID가 서버에 없으면 그 ID를 잊고 undefined를 돌려준다(새로 만들지 않는다)', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
  const clear = vi.fn();
  const save = vi.fn();
  const repository = createWorkflowRepository({ load: () => 'missing', save, clear }, request);
  await expect(repository.open()).resolves.toBeUndefined();
  expect(clear).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  await expect(repository.open()).resolves.toBeUndefined();
  expect(request).toHaveBeenCalledTimes(1);
});
it('서버 오류는 그대로 알리고 ID를 잊지 않는다', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
  const clear = vi.fn();
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn(), clear }, request);
  await expect(repository.open()).rejects.toThrow('500');
  expect(clear).not.toHaveBeenCalled();
});
it('고른 워크플로가 없으면 아무것도 만들지 않고 undefined를 돌려준다', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(respond(dto));
  const save = vi.fn();
  const repository = createWorkflowRepository({ load: () => undefined, save }, request);
  await expect(repository.open()).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});
it('동시 초기 로딩은 워크플로 요청을 하나만 보낸다', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(respond(dto));
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request);
  await Promise.all([repository.open(), repository.open()]);
  expect(request.mock.calls.filter(([url]) => url === '/api/v1/workflows/saved')).toHaveLength(1);
});
it('공정에서 만들 수 없는 진행 위치는 거부한다', async () => {
  const bad = { ...dto, phase: { kind: 'working', stageIndex: 0, completed: 99 } };
  const request = vi.fn<typeof fetch>().mockImplementation(respond(bad));
  await expect(createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request).open()).rejects.toThrow(
    'Invalid workflow response',
  );
});
it('재작업 범위와 사유를 복원하고, 맞지 않는 범위는 거부한다', async () => {
  const withRework = { ...dto, rework: { untilNumber: 4, reason: '누락' } };
  const ok = vi.fn<typeof fetch>().mockImplementationOnce(respond(withRework)).mockImplementationOnce(respond({}));
  const result = await createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, ok).open();
  expect(result?.state.rework).toEqual({ untilNumber: 4, reason: '누락' });

  const bad = { ...dto, rework: { untilNumber: 1, reason: '누락' } };
  const request = vi.fn<typeof fetch>().mockImplementation(respond(bad));
  await expect(createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request).open()).rejects.toThrow(
    'Invalid workflow response',
  );
});
it('다른 워크플로를 열면 소속 프로젝트와 보관 상태를 읽는다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ ...dto, id: 'other', name: '웹', projectId: 'p1', projectArchived: true }))
    .mockImplementationOnce(respond({}));
  const save = vi.fn();
  const repository = createWorkflowRepository({ load: () => 'saved', save }, request);
  repository.switchTo?.('other');
  expect(save).toHaveBeenCalledWith('other');
  const result = await repository.open();
  expect(request).toHaveBeenNthCalledWith(1, '/api/v1/workflows/other', {});
  expect(result).toMatchObject({ id: 'other', name: '웹', projectId: 'p1', projectArchived: true });
});

it('담당 배정과 내 실행 근거를 읽는다', async () => {
  const withAccess = {
    ...dto,
    permissions: ['project.view', 'workflow.execute', 'something.new'],
    assignments: {
      version: 3,
      stages: [{ stageId: 'planning', accountable: 'ann', responsible: ['bob'], consulted: [], informed: ['eve'] }],
      tasks: [{ taskId: 'goals', responsible: ['cho'] }],
    },
    authority: { tasks: { goals: null, 'user-research': 'assigned' }, stages: { planning: 'override', design: 'new' } },
  };
  const request = vi.fn<typeof fetch>().mockImplementationOnce(respond(withAccess)).mockImplementationOnce(respond({}));
  const result = await createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request).open();
  expect(result?.permissions).toEqual(['project.view', 'workflow.execute']);
  expect(result?.assignments).toEqual(withAccess.assignments);
  expect(result?.authority).toEqual({
    tasks: { goals: null, 'user-research': 'assigned' },
    stages: { planning: 'override', design: null },
  });

  const old = vi.fn<typeof fetch>().mockImplementationOnce(respond(dto)).mockImplementationOnce(respond({}));
  const plain = await createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, old).open();
  expect(plain?.assignments).toBeUndefined();
  expect(plain?.authority).toBeUndefined();
});

it('담당 배정은 기대 버전과 함께 PUT으로 통째로 보낸다', async () => {
  const input = {
    stages: [{ stageId: 'planning', accountable: 'ann', responsible: ['bob'], consulted: [], informed: [] }],
    tasks: [],
  };
  const request = vi.fn<typeof fetch>().mockImplementationOnce(respond({ version: 4, ...input }));
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request);
  await expect(repository.saveAssignments?.('w 1', 3, input)).resolves.toEqual({ version: 4, ...input });
  expect(request).toHaveBeenCalledWith('/api/v1/workflows/w%201/assignments', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 3, ...input }),
  });

  const conflict = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'versionConflict', message: 'x' } }), { status: 409 }),
    );
  const stale = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, conflict);
  await expect(stale.saveAssignments?.('w1', 3, input)).rejects.toMatchObject({ kind: 'versionConflict' });
});

it('권한이 없어 거절된 명령(403)은 종류를 붙여 알린다', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 }));
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request);
  await expect(repository.execute('saved', 2, { type: 'completeTask', taskId: 'goals' })).rejects.toMatchObject({
    kind: 'forbidden',
  });
});

it('preserves document and evidence on the wire and reports version conflicts', async () => {
  const patch = {
    document: { version: 1 as const, answers: { problem: 'Untracked requests' }, reviewStatus: 'pending' as const },
    evidence: [
      {
        id: 'f1',
        kind: 'file' as const,
        title: 'Notes',
        description: 'Interview notes',
        fileName: 'notes.txt',
        mediaType: 'text/plain',
        size: 2,
        base64: 'aGk=',
      },
    ],
  };
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ workflow: { ...dto, records: { goals: { link: '', note: '', ...patch } } } }));
  const repository = createWorkflowRepository({ load: () => 'saved', save: vi.fn() }, request);
  const saved = await repository.execute('saved', 2, { type: 'updateRecord', taskId: 'goals', patch });
  expect(saved.state.records.goals).toEqual({ link: '', note: '', ...patch });
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
    expectedVersion: 2,
    command: { type: 'updateRecord', taskId: 'goals', patch },
  });
  request.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: { code: 'versionConflict', message: 'stale' } }), { status: 409 }),
  );
  await expect(repository.execute('saved', 2, { type: 'completeTask', taskId: 'goals' })).rejects.toMatchObject({
    kind: 'versionConflict',
  });
});

it.each(['workflow', 'preferences'] as const)(
  'does not share a pending %s load across authenticated sessions',
  async (pending) => {
    let scope = 0;
    let release!: (response: Response) => void;
    let markPending!: () => void;
    const started = new Promise<void>((resolve) => {
      markPending = resolve;
    });
    let firstWorkflow = true;
    let firstPreferences = true;
    const request: typeof fetch = async (input) => {
      const preferences = String(input).endsWith('/preferences');
      if (
        (!preferences && firstWorkflow && pending === 'workflow') ||
        (preferences && firstPreferences && pending === 'preferences')
      ) {
        firstWorkflow = false;
        firstPreferences = false;
        markPending();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }
      if (!preferences) firstWorkflow = false;
      return new Response(JSON.stringify(preferences ? { locale: 'en' } : { ...dto, version: scope === 0 ? 2 : 9 }));
    };
    let identity = 'saved';
    const repository = createWorkflowRepository(
      {
        load: () => identity,
        save: (id) => {
          identity = id;
        },
      },
      request,
      '/api/v1',
      () => scope,
    );
    const previous = repository.open();
    await started;
    scope += 1;
    const current = repository.open();
    expect(current).not.toBe(previous);
    await expect(current).resolves.toMatchObject({ version: 9, preferences: { locale: 'en' } });
    release(new Response(JSON.stringify(pending === 'workflow' ? { ...dto, id: 'outdated' } : { locale: 'ko' })));
    await expect(previous).resolves.toBeUndefined();
    expect(identity).toBe('saved');
  },
);

it('does not clear a newer session identity when the old session returns 404 before another open', async () => {
  let scope = 0;
  let identity = 'previous';
  let release!: (response: Response) => void;
  const request: typeof fetch = async () =>
    new Promise<Response>((resolve) => {
      release = resolve;
    });
  const repository = createWorkflowRepository(
    {
      load: () => identity,
      save: (id) => {
        identity = id;
      },
      clear: () => {
        identity = '';
      },
    },
    request,
    '/api/v1',
    () => scope,
  );
  const previous = repository.open();
  scope += 1;
  identity = 'current';
  release(new Response('{}', { status: 404 }));
  await expect(previous).resolves.toBeUndefined();
  expect(identity).toBe('current');
});
