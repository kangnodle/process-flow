import {
  canApprove,
  validateTaskDocument,
  firstTaskOf,
  getRecord,
  getStage,
  getTask,
  isStageLocked,
  nextTask,
  previousTask,
  reworkPreview,
  type Process,
  type ReworkPreview,
  type StageDef,
  type TaskDef,
  type TaskId,
  type TaskRecord,
  type TaskStatus,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';
import { summarizeStages, taskRow, taskRows, type StageSummary, type TaskRow } from './stageSummary';
import { blockedReason, type TaskBlock } from './taskBlock';

export type TaskPrimaryLabel =
  | { readonly kind: 'markDone' }
  | { readonly kind: 'completeAndNext' }
  | { readonly kind: 'completeForApproval' }
  | { readonly kind: 'restartCycle' }
  | { readonly kind: 'approveStage'; readonly stageIndex: number }
  | { readonly kind: 'viewNextTask' };

export interface TaskPrimary {
  readonly label: TaskPrimaryLabel;
  readonly disabled: boolean;
  readonly action: WorkflowAction;
}

export type TaskHint =
  | TaskBlock
  | { readonly kind: 'approvalAfterThis'; readonly stageIndex: number }
  | { readonly kind: 'awaitingApproval'; readonly stageIndex: number };

export interface NavStage extends StageSummary {
  readonly tasks: readonly TaskRow[];
}

export interface TaskReopen {
  readonly action: WorkflowAction;
  readonly revokesApproval: number | null;
}

export interface TaskViewModel {
  readonly task: TaskDef;
  readonly stage: StageDef;
  readonly status: TaskStatus;
  readonly done: boolean;
  readonly locked: boolean;
  readonly record: TaskRecord;
  readonly previous: TaskDef | undefined;
  readonly next: TaskDef | undefined;
  readonly primary: TaskPrimary;
  readonly hint: TaskHint | null;
  readonly reopen: TaskReopen | null;
  readonly rework: boolean;
  readonly reworkPreview: ReworkPreview | null;
}

function decidePrimary(
  process: Process,
  state: WorkflowState,
  task: TaskDef,
  status: TaskStatus,
): { primary: TaskPrimary; hint: TaskHint | null } {
  const next = nextTask(process, task.id);
  const lastInStage = !next || next.stageIndex !== task.stageIndex;

  if (status !== 'done') {
    const label: TaskPrimaryLabel = !next
      ? { kind: 'markDone' }
      : lastInStage
        ? { kind: 'completeForApproval' }
        : { kind: 'completeAndNext' };
    const block = blockedReason(process, state, task);
    const hint: TaskHint | null =
      block ?? (next && lastInStage ? { kind: 'approvalAfterThis', stageIndex: task.stageIndex } : null);
    return {
      primary: {
        label,
        disabled: status !== 'doing' || validateTaskDocument(task.id, getRecord(state, task.id)).length > 0,
        action: { type: 'completeAndNext', taskId: task.id },
      },
      hint,
    };
  }

  if (!next) {
    return {
      primary: {
        label: { kind: 'restartCycle' },
        disabled: false,
        action: { type: 'selectTask', taskId: firstTaskOf(process, 0).id },
      },
      hint: null,
    };
  }

  if (isStageLocked(state, next.stageIndex)) {
    const approvable = canApprove(state, task.stageIndex, process);
    return {
      primary: {
        label: { kind: 'approveStage', stageIndex: next.stageIndex },
        disabled: !approvable,
        action: { type: 'approveStage', stageIndex: task.stageIndex },
      },
      hint: approvable ? { kind: 'awaitingApproval', stageIndex: task.stageIndex } : null,
    };
  }

  return {
    primary: { label: { kind: 'viewNextTask' }, disabled: false, action: { type: 'selectTask', taskId: next.id } },
    hint: null,
  };
}

export function buildTaskViewModel(process: Process, state: WorkflowState): TaskViewModel {
  const task = getTask(process, state.selectedTaskId);
  const row = taskRow(process, state, task);
  const { primary, hint } = decidePrimary(process, state, task, row.status);
  return {
    task,
    stage: getStage(process, task.stageIndex),
    status: row.status,
    done: row.done,
    locked: row.status === 'locked',
    record: getRecord(state, task.id),
    previous: previousTask(process, task.id),
    next: nextTask(process, task.id),
    primary,
    hint,
    reopen: row.toggle?.type === 'reopenTask' ? { action: row.toggle, revokesApproval: row.revokesApproval } : null,
    rework: row.rework,
    reworkPreview: reworkPreview(process, state, task.id),
  };
}

export function buildTaskNav(process: Process, state: WorkflowState): readonly NavStage[] {
  return summarizeStages(process, state).map((summary) => ({
    ...summary,
    tasks: taskRows(process, state, summary.stage),
  }));
}

export function navSelectAction(process: Process, state: WorkflowState, value: unknown): WorkflowAction | null {
  if (typeof value !== 'string') return null;
  const target = process.taskById.get(value as TaskId);
  if (!target || isStageLocked(state, target.stageIndex)) return null;
  return { type: 'selectTask', taskId: target.id };
}
