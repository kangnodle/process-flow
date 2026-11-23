import { describe, expect, it } from 'vitest';
import { defineProcess, getStage } from '../process/model';
import { taskForm } from '../process/taskForms';
import { STANDARD_PROCESS as P } from '../process/standard';
import { FINISHED, awaitingApproval, isValidPhase, working } from './phase';
import { createWorkflowReducer } from './reducer';
import {
  approvalRevokedByReopen,
  isRework,
  reworkPreview,
  canApprove,
  canReopen,
  getRecord,
  isDone,
  isProcessComplete,
  isStageLocked,
  overallProgress,
  taskStatus,
} from './selectors';
import { createDemoState, createInitialState, type WorkflowAction, type WorkflowState } from './state';

const documentReadyState = (): WorkflowState => ({
  ...createInitialState(P),
  records: Object.fromEntries(
    P.tasks.map((task) => [
      task.id,
      {
        link: '',
        note: '',
        document: {
          version: 1,
          reviewStatus: 'passed',
          answers: Object.fromEntries(
            taskForm(task.id).map((field) => [field.id, `Verified ${field.id} with the project team.`]),
          ),
        },
      },
    ]),
  ),
});

const reducer = createWorkflowReducer(P);
const run = (state: WorkflowState, ...actions: WorkflowAction[]): WorkflowState => actions.reduce(reducer, state);

const completeStage = (state: WorkflowState, stageIndex: number): WorkflowState =>
  run(state, ...getStage(P, stageIndex).tasks.map((t) => ({ type: 'completeTask', taskId: t.id }) as const));

const stage0 = getStage(P, 0).tasks;
const stage1 = getStage(P, 1).tasks;

describe('초기 상태', () => {
  it('1단계 첫 작업만 할 수 있고, 나머지는 대기하거나 잠겨 있다', () => {
    const state = documentReadyState();
    expect(state.phase).toEqual(working(0, 0));
    expect(state.selectedTaskId).toBe('goals');
    expect(taskStatus(P, state, stage0[0]!.id)).toBe('doing');
    expect(taskStatus(P, state, stage0[1]!.id)).toBe('todo');
    expect(taskStatus(P, state, stage1[0]!.id)).toBe('locked');
    expect(isStageLocked(state, 1)).toBe(true);
    expect(overallProgress(P, state).done).toBe(0);
  });

  it('시연용 상태는 1단계 완료·승인, 2단계 진행 중이다', () => {
    const state = createDemoState(P);
    expect(state.phase).toEqual(working(1, 0));
    expect(overallProgress(P, state).done).toBe(stage0.length);
    expect(state.selectedTaskId).toBe('wireframes');
  });
});

describe('순서대로만 완료한다', () => {
  it('차례인 작업만 완료할 수 있다', () => {
    const state = documentReadyState();
    const next = reducer(state, { type: 'completeTask', taskId: 'goals' });
    expect(isDone(P, next, 'goals')).toBe(true);
    expect(next.phase).toEqual(working(0, 1));
    expect(next.selectedTaskId).toBe('goals');
  });

  it('같은 단계라도 앞 작업을 건너뛰면 바뀌지 않는다 (같은 상태 객체 반환)', () => {
    const state = documentReadyState();
    expect(reducer(state, { type: 'completeTask', taskId: stage0[1]!.id })).toBe(state);
  });

  it('잠긴 단계의 작업은 완료할 수 없다', () => {
    const state = documentReadyState();
    expect(reducer(state, { type: 'completeTask', taskId: 'wireframes' })).toBe(state);
  });

  it('이미 완료한 작업을 다시 완료해도 바뀌지 않는다', () => {
    const state = run(documentReadyState(), { type: 'completeTask', taskId: 'goals' });
    expect(reducer(state, { type: 'completeTask', taskId: 'goals' })).toBe(state);
  });
});

describe('단계 승인', () => {
  it('단계 작업을 모두 마치면 다음 단계가 열리지 않고 승인을 기다린다', () => {
    const state = completeStage(documentReadyState(), 0);
    expect(state.phase).toEqual(awaitingApproval(0));
    expect(isStageLocked(state, 1)).toBe(true);
    expect(canApprove(state, 0)).toBe(true);
    expect(reducer(state, { type: 'completeTask', taskId: 'wireframes' })).toBe(state);
  });

  it('승인하면 다음 단계가 열리고 첫 작업이 선택된다', () => {
    const state = reducer(completeStage(documentReadyState(), 0), { type: 'approveStage', stageIndex: 0 });
    expect(state.phase).toEqual(working(1, 0));
    expect(state.selectedTaskId).toBe('wireframes');
  });

  it('작업이 남았거나, 승인 대기 중이 아닌 단계는 승인할 수 없다', () => {
    const partial = run(documentReadyState(), { type: 'completeTask', taskId: 'goals' });
    expect(reducer(partial, { type: 'approveStage', stageIndex: 0 })).toBe(partial);
    const demo = createDemoState(P);
    expect(reducer(demo, { type: 'approveStage', stageIndex: 0 })).toBe(demo);
  });

  it('마지막 단계는 승인 없이 공정 완료가 된다', () => {
    let state = documentReadyState();
    for (let i = 0; i <= P.lastStageIndex; i += 1) {
      state = completeStage(state, i);
      state = reducer(state, { type: 'approveStage', stageIndex: i });
    }
    expect(state.phase).toEqual(FINISHED);
    expect(isProcessComplete(state)).toBe(true);
    expect(overallProgress(P, state).done).toBe(P.tasks.length);
  });
});

describe('완료 취소', () => {
  it('가장 마지막으로 완료한 작업만 취소할 수 있다', () => {
    const state = run(
      documentReadyState(),
      { type: 'completeTask', taskId: stage0[0]!.id },
      { type: 'completeTask', taskId: stage0[1]!.id },
    );
    expect(canReopen(P, state, stage0[0]!.id)).toBe(false);
    expect(reducer(state, { type: 'reopenTask', taskId: stage0[0]!.id })).toBe(state);
    const reopened = reducer(state, { type: 'reopenTask', taskId: stage0[1]!.id });
    expect(reopened.phase).toEqual(working(0, 1));
  });

  it('완료하지 않은 작업은 취소할 것이 없다', () => {
    const state = documentReadyState();
    expect(reducer(state, { type: 'reopenTask', taskId: 'goals' })).toBe(state);
  });

  it('승인 대기 중에 마지막 작업을 취소하면 다시 작업 중이 된다', () => {
    const state = completeStage(documentReadyState(), 0);
    const reopened = reducer(state, { type: 'reopenTask', taskId: stage0.at(-1)!.id });
    expect(reopened.phase).toEqual(working(0, stage0.length - 1));
  });

  it('다음 단계에서 아직 아무것도 안 했다면, 앞 단계의 마지막 작업 취소는 승인도 취소한다', () => {
    const state = { ...createDemoState(P), selectedTaskId: 'wireframes' };
    const last = stage0.at(-1)!.id;
    expect(canReopen(P, state, last)).toBe(true);
    expect(approvalRevokedByReopen(P, state, last)).toBe(0);
    const reopened = reducer(state, { type: 'reopenTask', taskId: last });
    expect(reopened.phase).toEqual(working(0, stage0.length - 1));
    expect(isStageLocked(reopened, 1)).toBe(true);
    expect(reopened.selectedTaskId).toBe(last);
  });

  it('공정을 끝낸 뒤에도 마지막 작업을 취소할 수 있다', () => {
    const tiny = defineProcess({ stages: [{ id: 'a', tasks: ['a1'] }] });
    const tinyReducer = createWorkflowReducer(tiny);
    const done = tinyReducer(createInitialState(tiny), { type: 'completeTask', taskId: 'a1' });
    expect(done.phase).toEqual(FINISHED);
    expect(tinyReducer(done, { type: 'reopenTask', taskId: 'a1' }).phase).toEqual(working(0, 0));
  });
});

describe('completeAndNext', () => {
  it('같은 단계 안에서는 다음 작업으로 이동한다', () => {
    const state = run(documentReadyState(), { type: 'completeAndNext', taskId: 'goals' });
    expect(state.selectedTaskId).toBe(stage0[1]!.id);
  });

  it('단계의 마지막 작업이면 승인을 기다리며 그 작업에 머문다', () => {
    let state = documentReadyState();
    for (const task of stage0) state = reducer(state, { type: 'completeAndNext', taskId: task.id });
    expect(state.phase).toEqual(awaitingApproval(0));
    expect(state.selectedTaskId).toBe(stage0.at(-1)!.id);
  });

  it('차례가 아닌 작업은 완료하지 않는다', () => {
    const state = documentReadyState();
    expect(reducer(state, { type: 'completeAndNext', taskId: stage0[2]!.id })).toBe(state);
  });
});

describe('selectTask / setView', () => {
  it('선택과 뷰를 함께 바꿀 수 있다', () => {
    const state = run(documentReadyState(), { type: 'selectTask', taskId: 'requirements', view: 'task' });
    expect(state.selectedTaskId).toBe('requirements');
    expect(state.view).toBe('task');
  });

  it('바뀌는 것이 없으면 같은 상태 객체를 돌려준다', () => {
    const state = documentReadyState();
    expect(reducer(state, { type: 'setView', view: state.view })).toBe(state);
    expect(reducer(state, { type: 'selectTask', taskId: 'goals' })).toBe(state);
  });

  it('알 수 없는 작업을 고르거나 완료하면 예외를 던진다', () => {
    expect(() => reducer(documentReadyState(), { type: 'selectTask', taskId: 'nope' })).toThrow();
    expect(() => reducer(documentReadyState(), { type: 'completeTask', taskId: 'nope' })).toThrow();
  });
});

describe('updateRecord', () => {
  it('링크와 메모를 부분 갱신한다', () => {
    const s1 = run(createInitialState(P), {
      type: 'updateRecord',
      taskId: 'goals',
      patch: { link: 'https://example.com' },
    });
    const s2 = run(s1, { type: 'updateRecord', taskId: 'goals', patch: { note: '검토 완료' } });
    expect(getRecord(s2, 'goals')).toEqual({ link: 'https://example.com', note: '검토 완료' });
  });

  it('값이 같으면 같은 상태 객체를 돌려준다', () => {
    const state = createInitialState(P);
    expect(reducer(state, { type: 'updateRecord', taskId: 'goals', patch: { link: '' } })).toBe(state);
  });

  it('빈 기록은 제거한다', () => {
    const state = run(createInitialState(P), { type: 'updateRecord', taskId: 'goals', patch: { note: 'memo' } });
    expect(reducer(state, { type: 'updateRecord', taskId: 'goals', patch: { note: '' } }).records).toEqual({});
  });
});

describe('isValidPhase', () => {
  it('공정에서 만들 수 있는 위치만 받아들인다', () => {
    expect(isValidPhase(P, working(0, 0))).toBe(true);
    expect(isValidPhase(P, awaitingApproval(0))).toBe(true);
    expect(isValidPhase(P, FINISHED)).toBe(true);
    expect(isValidPhase(P, working(0, stage0.length))).toBe(false);
    expect(isValidPhase(P, working(P.lastStageIndex + 1, 0))).toBe(false);
    expect(isValidPhase(P, awaitingApproval(P.lastStageIndex))).toBe(false);
    expect(isValidPhase(P, { kind: 'other' })).toBe(false);
    expect(isValidPhase(P, null)).toBe(false);
  });
});

describe('다른 공정에도 같은 규칙이 적용된다', () => {
  const tiny = defineProcess({
    stages: [
      { id: 'a', tasks: ['a1'] },
      { id: 'b', tasks: ['b1', 'b2'] },
    ],
  });
  const tinyReducer = createWorkflowReducer(tiny);

  it('작은 공정에서도 단계를 마치면 승인 뒤 다음 단계가 열린다', () => {
    const done = tinyReducer(createInitialState(tiny), { type: 'completeAndNext', taskId: 'a1' });
    expect(done.phase).toEqual(awaitingApproval(0));
    const approved = tinyReducer(done, { type: 'approveStage', stageIndex: 0 });
    expect(approved.selectedTaskId).toBe('b1');
  });

  it('다른 공정의 작업 ID는 모르는 작업으로 다룬다', () => {
    expect(() => tinyReducer(createInitialState(tiny), { type: 'selectTask', taskId: 'goals' })).toThrow();
  });
});

describe('재작업', () => {
  const midStage2 = () => {
    let state = completeStage(documentReadyState(), 0);
    state = run(state, { type: 'approveStage', stageIndex: 0 });
    return run(state, { type: 'completeTask', taskId: stage1[0]!.id }, { type: 'completeTask', taskId: stage1[1]!.id });
  };

  it('완료한 작업부터 지금 진행 중인 작업까지 모두 재작업 대상이 되고, 앞 단계 승인은 취소된다', () => {
    const state = midStage2();
    const target = stage0[3]!;
    const preview = reworkPreview(P, state, target.id);
    expect(preview).toMatchObject({ from: target, through: stage1[2], revokedApprovals: [0] });
    expect(preview?.count).toBe(stage1[2]!.number - target.number + 1);

    const next = reducer(state, { type: 'requestRework', taskId: target.id, reason: ' 요구사항 누락 ' });
    expect(next.phase).toEqual(working(0, 3));
    expect(next.rework).toEqual({ untilNumber: stage1[2]!.number, reason: '요구사항 누락' });
    expect(next.selectedTaskId).toBe(target.id);
    expect(isStageLocked(next, 1)).toBe(true);
    expect(isDone(P, next, stage0[2]!.id)).toBe(true);
    expect(taskStatus(P, next, target.id)).toBe('doing');
    expect(isRework(P, next, target.id)).toBe(true);
    expect(isRework(P, next, stage1[2]!.id)).toBe(true);
    expect(isRework(P, next, stage1[3]!.id)).toBe(false);
  });

  it('사유가 없거나 완료하지 않은 작업이면 바뀌지 않는다', () => {
    const state = midStage2();
    expect(reducer(state, { type: 'requestRework', taskId: stage0[0]!.id, reason: '  ' })).toBe(state);
    expect(reducer(state, { type: 'requestRework', taskId: stage1[3]!.id, reason: '왜' })).toBe(state);
    expect(reworkPreview(P, state, stage1[2]!.id)).toBeNull();
  });

  it('재작업도 순서대로 다시 완료하고, 범위를 넘어서면 재작업이 끝난다', () => {
    let state = reducer(midStage2(), { type: 'requestRework', taskId: stage1[0]!.id, reason: '디자인 변경' });
    expect(state.phase).toEqual(working(1, 0));
    expect(reducer(state, { type: 'completeTask', taskId: stage1[1]!.id })).toBe(state);
    state = run(
      state,
      { type: 'completeTask', taskId: stage1[0]!.id },
      { type: 'completeTask', taskId: stage1[1]!.id },
    );
    expect(state.rework).not.toBeNull();
    state = reducer(state, { type: 'completeTask', taskId: stage1[2]!.id });
    expect(state.rework).toBeNull();
  });

  it('재작업 중에 더 앞 작업을 재작업하면 범위가 넓어진다', () => {
    let state = reducer(midStage2(), { type: 'requestRework', taskId: stage1[1]!.id, reason: '첫 번째' });
    state = reducer(state, { type: 'requestRework', taskId: stage1[0]!.id, reason: '두 번째' });
    expect(state.rework).toEqual({ untilNumber: stage1[2]!.number, reason: '두 번째' });
    expect(state.phase).toEqual(working(1, 0));
  });

  it('공정을 끝낸 뒤에도 재작업할 수 있고, 지나온 승인은 모두 취소된다', () => {
    let state = documentReadyState();
    for (let i = 0; i <= P.lastStageIndex; i += 1) {
      state = completeStage(state, i);
      state = reducer(state, { type: 'approveStage', stageIndex: i });
    }
    const preview = reworkPreview(P, state, stage1[0]!.id);
    expect(preview?.revokedApprovals).toEqual([1, 2, 3, 4]);
    expect(preview?.through).toBe(P.tasks.at(-1));
  });
});
