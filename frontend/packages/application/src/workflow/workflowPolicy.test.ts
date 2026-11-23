import { expect, it } from 'vitest';
import type { PersistentAction } from '@process-flow/domain';
import { enqueueWorkflowAction } from '../index';

it('보내는 중인 기록은 보존하고 뒤에 대기 중인 같은 작업의 변경만 합친다', () => {
  const sending: PersistentAction = { type: 'updateRecord', taskId: 'goals', patch: { note: 'sent' } };
  const queued: PersistentAction = { type: 'updateRecord', taskId: 'goals', patch: { note: 'new' } };
  const edit: PersistentAction = { type: 'updateRecord', taskId: 'goals', patch: { link: 'https://example.com' } };

  expect(enqueueWorkflowAction([sending], queued, true)).toEqual([sending, queued]);
  const queue = Object.freeze([sending, queued]);
  expect(enqueueWorkflowAction(queue, edit, true)).toEqual([
    sending,
    { ...queued, patch: { note: 'new', link: 'https://example.com' } },
  ]);
  expect(queue[1]).toBe(queued);
});
