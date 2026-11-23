import { taskForm } from '@process-flow/domain';
import {
  STANDARD_PROCESS as P,
  createDemoState,
  createInitialState,
  createWorkflowReducer,
  getStage,
  getTask,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';
import { describe, expect, it } from 'vitest';
import { buildBoardViewModel } from './boardView';
import { buildStageViewModel } from './stageView';
import { buildTaskViewModel, navSelectAction } from './taskView';

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
const run = (state: WorkflowState, ...actions: WorkflowAction[]) => actions.reduce(reducer, state);
const completeAll = (state: WorkflowState, stageIndex: number) =>
  run(state, ...getStage(P, stageIndex).tasks.map((t) => ({ type: 'completeTask', taskId: t.id }) as const));
const stage0 = getStage(P, 0).tasks;

describe('buildStageViewModel', () => {
  it('최전방 단계에 남은 작업이 있으면 승인이 막히고 남은 수를 알린다', () => {
    const vm = buildStageViewModel(P, documentReadyState());
    expect(vm.primary).toEqual({
      kind: 'approveStage',
      blocked: true,
      action: { type: 'approveStage', stageIndex: 0 },
    });
    expect(vm.message).toEqual({ kind: 'remainingToApprove', remaining: 7 });
    expect(vm.previous).toBeNull();
  });

  it('차례인 작업만 체크할 수 있다', () => {
    const vm = buildStageViewModel(P, documentReadyState());
    expect(vm.tasks.map((row) => row.status)).toEqual(['doing', ...stage0.slice(1).map(() => 'todo')]);
    expect(vm.tasks[0]?.toggle).toEqual({ type: 'completeTask', taskId: 'goals' });
    expect(vm.tasks.slice(1).every((row) => row.toggle === null)).toBe(true);
  });

  it('완료한 작업 중 마지막 것만 완료를 취소할 수 있다', () => {
    const state = run(
      documentReadyState(),
      { type: 'completeTask', taskId: stage0[0]!.id },
      { type: 'completeTask', taskId: stage0[1]!.id },
    );
    const vm = buildStageViewModel(P, state);
    expect(vm.tasks[0]?.toggle).toBeNull();
    expect(vm.tasks[1]?.toggle).toEqual({ type: 'reopenTask', taskId: stage0[1]!.id });
    expect(vm.tasks[2]?.toggle).toEqual({ type: 'completeTask', taskId: stage0[2]!.id });
  });

  it('최전방 단계를 마치면 승인을 기다린다고 알린다', () => {
    const vm = buildStageViewModel(P, completeAll(documentReadyState(), 0));
    expect(vm.primary.blocked).toBe(false);
    expect(vm.awaitingApproval).toBe(true);
    expect(vm.message).toEqual({ kind: 'awaitingApproval', nextStage: getStage(P, 1) });
  });

  it('지나온 단계에서는 이미 열린 다음 단계로 이동한다', () => {
    const state = run(createDemoState(P), { type: 'selectTask', taskId: 'goals' });
    const vm = buildStageViewModel(P, state);
    expect(vm.passed).toBe(true);
    expect(vm.primary).toEqual({
      kind: 'goNextStage',
      blocked: false,
      action: { type: 'selectTask', taskId: 'wireframes' },
    });
    expect(vm.message).toBeNull();
    expect(vm.tasks.at(-1)?.revokesApproval).toBe(0);
  });

  it('잠긴 단계를 보고 있으면 다음 단계로 이동도 막힌다', () => {
    const state = run(documentReadyState(), { type: 'selectTask', taskId: 'dev-environment' });
    const vm = buildStageViewModel(P, state);
    expect(vm.locked).toBe(true);
    expect(vm.primary).toMatchObject({ kind: 'goNextStage', blocked: true });
  });
});

describe('buildTaskViewModel', () => {
  it('단계의 마지막 작업이면 완료하고 승인을 요청한다고 알린다', () => {
    let state = documentReadyState();
    for (const task of stage0.slice(0, -1)) state = run(state, { type: 'completeAndNext', taskId: task.id });
    const vm = buildTaskViewModel(P, state);
    expect(vm.task.id).toBe('constraints');
    expect(vm.primary).toMatchObject({ label: { kind: 'completeForApproval' }, disabled: false });
    expect(vm.hint).toEqual({ kind: 'approvalAfterThis', stageIndex: 0 });
  });

  it('앞 작업이 남았으면 완료가 막히고 차례인 작업을 알린다', () => {
    const state = run(documentReadyState(), { type: 'selectTask', taskId: 'constraints' });
    const vm = buildTaskViewModel(P, state);
    expect(vm.status).toBe('todo');
    expect(vm.primary.disabled).toBe(true);
    expect(vm.hint).toEqual({ kind: 'waitForPrevious', due: getTask(P, 'goals') });
  });

  it('잠긴 작업은 완료 버튼이 막히고 언제 열리는지 알린다', () => {
    const state = run(documentReadyState(), { type: 'selectTask', taskId: 'wireframes' });
    const vm = buildTaskViewModel(P, state);
    expect(vm.primary.disabled).toBe(true);
    expect(vm.hint).toEqual({ kind: 'stageLocked', stageIndex: 1 });
  });

  it('완료한 작업에서 다음 작업이 열려 있으면 다음 작업 보기로 이동하고, 완료를 취소할 수 있다', () => {
    const state = run(documentReadyState(), { type: 'completeTask', taskId: 'goals' });
    const vm = buildTaskViewModel(P, state);
    expect(vm.primary).toEqual({
      label: { kind: 'viewNextTask' },
      disabled: false,
      action: { type: 'selectTask', taskId: 'user-research' },
    });
    expect(vm.reopen).toEqual({ action: { type: 'reopenTask', taskId: 'goals' }, revokesApproval: null });
  });

  it('단계를 마치면 승인하고 다음 단계를 여는 버튼을 낸다', () => {
    let state = documentReadyState();
    for (const task of stage0) state = run(state, { type: 'completeAndNext', taskId: task.id });
    const vm = buildTaskViewModel(P, state);
    expect(vm.primary).toEqual({
      label: { kind: 'approveStage', stageIndex: 1 },
      disabled: false,
      action: { type: 'approveStage', stageIndex: 0 },
    });
    expect(vm.hint).toEqual({ kind: 'awaitingApproval', stageIndex: 0 });
  });

  it('측면 탐색에서 잠긴 작업이나 모르는 값은 무시한다', () => {
    const state = documentReadyState();
    expect(navSelectAction(P, state, 'user-research')).toEqual({ type: 'selectTask', taskId: 'user-research' });
    expect(navSelectAction(P, state, 'wireframes')).toBeNull();
    expect(navSelectAction(P, state, 'stage-0')).toBeNull();
    expect(navSelectAction(P, state, 3)).toBeNull();
  });
});

describe('buildBoardViewModel', () => {
  it('열 안내: 잠긴 단계, 남은 작업, 승인 대기, 모두 완료', () => {
    const vm = buildBoardViewModel(P, documentReadyState());
    expect(vm.columns[0]?.hint).toEqual({ kind: 'tasksLeft', count: 7 });
    expect(vm.columns[1]?.hint).toEqual({ kind: 'unlocksAfter', stageIndex: 1 });

    const waiting = completeAll(documentReadyState(), 0);
    expect(buildBoardViewModel(P, waiting).columns[0]).toMatchObject({
      hint: { kind: 'awaitingApproval' },
      canApprove: true,
    });

    let state = documentReadyState();
    for (const stage of P.stages) {
      state = completeAll(state, stage.index);
      state = run(state, { type: 'approveStage', stageIndex: stage.index });
    }
    expect(buildBoardViewModel(P, state).columns.at(-1)?.hint).toEqual({ kind: 'allStagesDone' });
  });

  it('고른 카드의 완료/취소가 막힌 이유를 알린다', () => {
    const state = run(
      documentReadyState(),
      { type: 'completeTask', taskId: stage0[0]!.id },
      { type: 'completeTask', taskId: stage0[1]!.id },
      { type: 'selectTask', taskId: stage0[0]!.id },
    );
    expect(buildBoardViewModel(P, state).selected.blocked).toEqual({
      kind: 'onlyLastReopenable',
      last: stage0[1],
    });
  });
});

describe('재작업 표시', () => {
  it('재작업 범위의 작업은 rework로 표시되고, 완료한 작업에서만 재작업을 요청할 수 있다', () => {
    const state = run(createDemoState(P), { type: 'requestRework', taskId: stage0[5]!.id, reason: '흐름 누락' });
    const stageVm = buildStageViewModel(P, run(state, { type: 'selectTask', taskId: stage0[0]!.id }));
    expect(stageVm.tasks.map((row) => row.rework)).toEqual([false, false, false, false, false, true, true]);
    expect(stageVm.tasks[5]).toMatchObject({ status: 'doing', rework: true });

    const taskVm = buildTaskViewModel(P, state);
    expect(taskVm.rework).toBe(true);
    expect(taskVm.reworkPreview).toBeNull();
    const doneVm = buildTaskViewModel(P, run(state, { type: 'selectTask', taskId: stage0[0]!.id }));
    expect(doneVm.reworkPreview?.from.id).toBe(stage0[0]!.id);
  });
});
