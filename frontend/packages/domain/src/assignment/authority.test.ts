import { STANDARD_PROCESS } from '../process/standard';
import { expect, it } from 'vitest';
import type { Assignments, WorkflowAuthority } from './model';
import { actionTarget, assigneesOf, authorityOf, blockOf, responsibleFor } from './authority';

const assignments: Assignments = {
  version: 1,
  stages: [{ stageId: 'planning', accountable: 'ann', responsible: ['bob'], consulted: [], informed: [] }],
  tasks: [{ taskId: 'goals', responsible: ['cho'] }],
};
const authority: WorkflowAuthority = {
  tasks: { goals: null, 'user-research': 'assigned', wireframes: 'open' },
  stages: { planning: 'override', design: null },
};

it('동작이 누구의 일인지 가린다: 작업은 담당자, 승인과 재작업 요청은 그 단계의 승인자', () => {
  expect(actionTarget(STANDARD_PROCESS, { type: 'completeAndNext', taskId: 'goals' })).toEqual({
    kind: 'task',
    id: 'goals',
  });
  expect(actionTarget(STANDARD_PROCESS, { type: 'updateRecord', taskId: 'goals', patch: {} })?.kind).toBe('task');
  expect(actionTarget(STANDARD_PROCESS, { type: 'approveStage', stageIndex: 1 })).toEqual({
    kind: 'stage',
    id: 'design',
  });
  expect(actionTarget(STANDARD_PROCESS, { type: 'requestRework', taskId: 'goals', reason: 'x' })).toEqual({
    kind: 'stage',
    id: 'planning',
  });
  expect(actionTarget(STANDARD_PROCESS, { type: 'setView', view: 'board' })).toBeNull();
});

it('서버가 준 근거를 그대로 쓰고, 근거가 없으면 제한이 없다고 본다', () => {
  expect(authorityOf(STANDARD_PROCESS, authority, { type: 'completeTask', taskId: 'goals' })).toBeNull();
  expect(authorityOf(STANDARD_PROCESS, authority, { type: 'completeTask', taskId: 'user-research' })).toBe('assigned');
  expect(authorityOf(STANDARD_PROCESS, authority, { type: 'approveStage', stageIndex: 0 })).toBe('override');
  expect(authorityOf(STANDARD_PROCESS, authority, { type: 'approveStage', stageIndex: 1 })).toBeNull();
  expect(authorityOf(STANDARD_PROCESS, authority, { type: 'selectTask', taskId: 'goals' })).toBe('open');
  expect(authorityOf(STANDARD_PROCESS, undefined, { type: 'completeTask', taskId: 'goals' })).toBe('open');
});

it('작업 담당자가 없으면 단계의 담당자를 따른다', () => {
  expect(responsibleFor(STANDARD_PROCESS, assignments, 'goals')).toEqual(['cho']);
  expect(responsibleFor(STANDARD_PROCESS, assignments, 'user-research')).toEqual(['bob']);
  expect(responsibleFor(STANDARD_PROCESS, assignments, 'wireframes')).toEqual([]);
  expect(assigneesOf(STANDARD_PROCESS, assignments, { type: 'approveStage', stageIndex: 0 })).toEqual(['ann']);
  expect(assigneesOf(STANDARD_PROCESS, assignments, { type: 'completeTask', taskId: 'goals' })).toEqual(['cho']);
});

it('할 수 없는 이유를 알려 준다: 보기 전용이 먼저고, 그다음이 배정', () => {
  const access = { readOnly: false, authority, assignments };
  expect(blockOf(STANDARD_PROCESS, access, { type: 'completeTask', taskId: 'goals' })).toEqual({
    kind: 'notResponsible',
    users: ['cho'],
  });
  expect(blockOf(STANDARD_PROCESS, access, { type: 'requestRework', taskId: 'wireframes', reason: 'x' })).toEqual({
    kind: 'notAccountable',
    user: undefined,
  });
  expect(blockOf(STANDARD_PROCESS, access, { type: 'completeTask', taskId: 'user-research' })).toBeNull();
  expect(blockOf(STANDARD_PROCESS, access, { type: 'setView', view: 'task' })).toBeNull();
  expect(
    blockOf(STANDARD_PROCESS, { ...access, readOnly: true }, { type: 'completeTask', taskId: 'user-research' }),
  ).toEqual({ kind: 'readOnly' });
});
