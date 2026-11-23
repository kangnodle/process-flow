import { getStage, type Process, type TaskDef, type TaskId } from '../process/model';

export type Phase =
  | { readonly kind: 'working'; readonly stageIndex: number; readonly completed: number }
  | { readonly kind: 'awaitingApproval'; readonly stageIndex: number }
  | { readonly kind: 'finished' };

export const working = (stageIndex: number, completed = 0): Phase => ({ kind: 'working', stageIndex, completed });
export const awaitingApproval = (stageIndex: number): Phase => ({ kind: 'awaitingApproval', stageIndex });
export const FINISHED: Phase = { kind: 'finished' };
export const INITIAL_PHASE: Phase = working(0, 0);

export function isValidPhase(process: Process, value: unknown): value is Phase {
  if (typeof value !== 'object' || value === null) return false;
  const phase = value as Record<string, unknown>;
  const stageIndex = phase['stageIndex'];
  const validStage = (index: unknown): index is number =>
    Number.isInteger(index) && (index as number) >= 0 && (index as number) <= process.lastStageIndex;
  switch (phase['kind']) {
    case 'working': {
      const completed = phase['completed'];
      return (
        validStage(stageIndex) &&
        Number.isInteger(completed) &&
        (completed as number) >= 0 &&
        (completed as number) < getStage(process, stageIndex).tasks.length
      );
    }
    case 'awaitingApproval':
      return validStage(stageIndex) && stageIndex < process.lastStageIndex;
    case 'finished':
      return true;
    default:
      return false;
  }
}

export function frontStageIndex(process: Process, phase: Phase): number {
  return phase.kind === 'finished' ? process.lastStageIndex : phase.stageIndex;
}

function tasksBefore(process: Process, stageIndex: number): number {
  return process.stages.slice(0, stageIndex).reduce((sum, stage) => sum + stage.tasks.length, 0);
}

export function completedCount(process: Process, phase: Phase): number {
  switch (phase.kind) {
    case 'working':
      return tasksBefore(process, phase.stageIndex) + phase.completed;
    case 'awaitingApproval':
      return tasksBefore(process, phase.stageIndex + 1);
    case 'finished':
      return process.tasks.length;
  }
}

export function currentTask(process: Process, phase: Phase): TaskDef | undefined {
  return phase.kind === 'working' ? getStage(process, phase.stageIndex).tasks[phase.completed] : undefined;
}

export function lastCompletedTask(process: Process, phase: Phase): TaskDef | undefined {
  const count = completedCount(process, phase);
  return count === 0 ? undefined : process.tasks[count - 1];
}

export function completeTask(process: Process, phase: Phase, taskId: TaskId): Phase | null {
  if (phase.kind !== 'working' || currentTask(process, phase)?.id !== taskId) return null;
  const completed = phase.completed + 1;
  if (completed < getStage(process, phase.stageIndex).tasks.length) return working(phase.stageIndex, completed);
  return phase.stageIndex === process.lastStageIndex ? FINISHED : awaitingApproval(phase.stageIndex);
}

export function approveStage(phase: Phase, stageIndex: number): Phase | null {
  return phase.kind === 'awaitingApproval' && phase.stageIndex === stageIndex ? working(stageIndex + 1, 0) : null;
}

export interface Reopened {
  readonly phase: Phase;
  readonly revokedApproval: number | null;
}

export function reopenTask(process: Process, phase: Phase, taskId: TaskId): Reopened | null {
  const last = lastCompletedTask(process, phase);
  if (!last || last.id !== taskId) return null;
  const stageSize = getStage(process, last.stageIndex).tasks.length;
  const reopened = working(last.stageIndex, stageSize - 1);
  switch (phase.kind) {
    case 'working':
      return phase.completed > 0
        ? { phase: working(phase.stageIndex, phase.completed - 1), revokedApproval: null }
        : { phase: reopened, revokedApproval: last.stageIndex };
    case 'awaitingApproval':
    case 'finished':
      return { phase: reopened, revokedApproval: null };
  }
}

export function reachedNumber(process: Process, phase: Phase): number {
  return completedCount(process, phase) + (phase.kind === 'working' ? 1 : 0);
}

export interface Rewound {
  readonly phase: Phase;
  readonly revokedApprovals: readonly number[];
}

export function rewindTo(process: Process, phase: Phase, taskId: TaskId): Rewound | null {
  const task = process.taskById.get(taskId);
  if (!task || task.number > completedCount(process, phase)) return null;
  const stage = getStage(process, task.stageIndex);
  const front = frontStageIndex(process, phase);
  const revokedApprovals: number[] = [];
  for (let index = task.stageIndex; index < front; index += 1) revokedApprovals.push(index);
  return { phase: working(task.stageIndex, stage.tasks.indexOf(task)), revokedApprovals };
}
