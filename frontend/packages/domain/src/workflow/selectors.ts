import { getStage, getTask, type Process, type TaskDef, type TaskId } from '../process/model';
import {
  completedCount,
  currentTask,
  frontStageIndex,
  lastCompletedTask,
  reachedNumber,
  reopenTask,
  rewindTo,
} from './phase';
import { STANDARD_PROCESS } from '../process/standard';
import { validateTaskDocument } from '../process/taskForms';
import { EMPTY_RECORD, type TaskRecord, type WorkflowState } from './state';

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly ratio: number;
}

const progressOf = (done: number, total: number): Progress => ({ done, total, ratio: total === 0 ? 0 : done / total });

export type TaskStatus = 'done' | 'doing' | 'todo' | 'locked';

export function isDone(process: Process, state: WorkflowState, taskId: TaskId): boolean {
  return getTask(process, taskId).number <= completedCount(process, state.phase);
}

export function isStageLocked(state: WorkflowState, stageIndex: number): boolean {
  return state.phase.kind !== 'finished' && stageIndex > state.phase.stageIndex;
}

export function isTaskLocked(process: Process, state: WorkflowState, taskId: TaskId): boolean {
  return isStageLocked(state, getTask(process, taskId).stageIndex);
}

export function taskStatus(process: Process, state: WorkflowState, taskId: TaskId): TaskStatus {
  if (isDone(process, state, taskId)) return 'done';
  if (isTaskLocked(process, state, taskId)) return 'locked';
  return currentTask(process, state.phase)?.id === taskId ? 'doing' : 'todo';
}

export function currentTaskId(process: Process, state: WorkflowState): TaskId | undefined {
  return currentTask(process, state.phase)?.id;
}

export function reopenableTaskId(process: Process, state: WorkflowState): TaskId | undefined {
  return lastCompletedTask(process, state.phase)?.id;
}

export function canReopen(process: Process, state: WorkflowState, taskId: TaskId): boolean {
  return reopenableTaskId(process, state) === taskId;
}

export function approvalRevokedByReopen(process: Process, state: WorkflowState, taskId: TaskId): number | null {
  return reopenTask(process, state.phase, taskId)?.revokedApproval ?? null;
}

export function frontStage(process: Process, state: WorkflowState): number {
  return frontStageIndex(process, state.phase);
}

export function isAwaitingApproval(state: WorkflowState, stageIndex: number): boolean {
  return state.phase.kind === 'awaitingApproval' && state.phase.stageIndex === stageIndex;
}

export function canApprove(state: WorkflowState, stageIndex: number, process: Process = STANDARD_PROCESS): boolean {
  return (
    isAwaitingApproval(state, stageIndex) &&
    getStage(process, stageIndex).tasks.every(
      (task) => validateTaskDocument(task.id, getRecord(state, task.id)).length === 0,
    )
  );
}

export function isStageApproved(process: Process, state: WorkflowState, stageIndex: number): boolean {
  return stageIndex < frontStage(process, state);
}

export function countDoneInStage(process: Process, state: WorkflowState, stageIndex: number): number {
  return getStage(process, stageIndex).tasks.filter((task) => isDone(process, state, task.id)).length;
}

export function isStageComplete(process: Process, state: WorkflowState, stageIndex: number): boolean {
  return countDoneInStage(process, state, stageIndex) === getStage(process, stageIndex).tasks.length;
}

export function remainingInStage(process: Process, state: WorkflowState, stageIndex: number): number {
  return getStage(process, stageIndex).tasks.length - countDoneInStage(process, state, stageIndex);
}

export function overallProgress(process: Process, state: WorkflowState): Progress {
  return progressOf(completedCount(process, state.phase), process.tasks.length);
}

export function stageProgress(process: Process, state: WorkflowState, stageIndex: number): Progress {
  return progressOf(countDoneInStage(process, state, stageIndex), getStage(process, stageIndex).tasks.length);
}

export function progressKey(state: WorkflowState): string {
  const { phase, rework } = state;
  const at =
    phase.kind === 'working'
      ? `w${phase.stageIndex}.${phase.completed}`
      : phase.kind === 'awaitingApproval'
        ? `a${phase.stageIndex}`
        : 'f';
  return rework ? `${at}~${rework.untilNumber}` : at;
}

export function getRecord(state: WorkflowState, taskId: TaskId): TaskRecord {
  return state.records[taskId] ?? EMPTY_RECORD;
}

export function isProcessComplete(state: WorkflowState): boolean {
  return state.phase.kind === 'finished';
}

export function isRework(process: Process, state: WorkflowState, taskId: TaskId): boolean {
  if (!state.rework) return false;
  const number = getTask(process, taskId).number;
  return number > completedCount(process, state.phase) && number <= state.rework.untilNumber;
}

export interface ReworkPreview {
  readonly from: TaskDef;
  readonly through: TaskDef;
  readonly count: number;
  readonly revokedApprovals: readonly number[];
}

export function reworkPreview(process: Process, state: WorkflowState, taskId: TaskId): ReworkPreview | null {
  const rewound = rewindTo(process, state.phase, taskId);
  if (!rewound) return null;
  const from = getTask(process, taskId);
  const untilNumber = Math.max(reachedNumber(process, state.phase), state.rework?.untilNumber ?? 0);
  const through = process.tasks[untilNumber - 1] ?? from;
  return { from, through, count: through.number - from.number + 1, revokedApprovals: rewound.revokedApprovals };
}
