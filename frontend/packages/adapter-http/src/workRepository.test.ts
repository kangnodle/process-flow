import { expect, it, vi } from 'vitest';
import { RequestError } from '@process-flow/application';
import { createWorkRepository } from './workRepository';

const base = {
  projectId: 'p1',
  projectName: '결제 개편',
  workflowId: 'w1',
  workflowName: '웹',
  stageId: 'planning',
  stageIndex: 0,
  rework: false,
};
const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status });

it('내 할 일을 읽고, 모르는 종류의 항목은 버린다', async () => {
  const items = [
    { ...base, group: 'ready', kind: 'task', taskId: 'goals', taskNumber: 1, wait: null, rework: true },
    {
      ...base,
      group: 'waiting',
      kind: 'approval',
      taskId: null,
      taskNumber: null,
      wait: { kind: 'afterTasks', remaining: 7 },
    },
    { ...base, group: 'waiting', kind: 'task', taskId: 'wireframes', taskNumber: 8, wait: { kind: 'stageLocked' } },
    { ...base, group: 'watching', kind: 'informed', taskId: null, taskNumber: null, wait: null },
    { ...base, group: 'someday', kind: 'task', taskId: 'goals', taskNumber: 1 },
    { ...base, group: 'ready', kind: 'task' },
  ];
  const request = vi.fn<typeof fetch>().mockImplementation(respond({ items }));
  const mine = await createWorkRepository(request).mine();
  expect(request).toHaveBeenCalledWith('/api/v1/me/work', {});
  expect(mine).toEqual([
    { ...base, group: 'ready', kind: 'task', taskId: 'goals', taskNumber: 1, rework: true },
    { ...base, group: 'waiting', kind: 'approval', wait: { kind: 'afterTasks', remaining: 7 } },
    { ...base, group: 'waiting', kind: 'task', taskId: 'wireframes', taskNumber: 8, wait: { kind: 'stageLocked' } },
    { ...base, group: 'watching', kind: 'informed' },
  ]);
});

it('모양이 틀린 응답과 서버 오류를 거절한다', async () => {
  const invalid = vi.fn<typeof fetch>().mockImplementation(respond({ items: 'nope' }));
  await expect(createWorkRepository(invalid).mine()).rejects.toBeInstanceOf(RequestError);
  const unauthenticated = vi
    .fn<typeof fetch>()
    .mockImplementation(respond({ error: { code: 'unauthenticated', message: 'x' } }, 401));
  await expect(createWorkRepository(unauthenticated).mine()).rejects.toMatchObject({ kind: 'unauthenticated' });
});
