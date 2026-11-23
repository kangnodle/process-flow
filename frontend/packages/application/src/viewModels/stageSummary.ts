import {
  approvalRevokedByReopen,
  canApprove,
  frontStage,
  isAwaitingApproval,
  isStageComplete,
  isRework,
  isStageLocked,
  reopenableTaskId,
  stageProgress,
  taskStatus,
  type Process,
  type Progress,
  type StageDef,
  type TaskDef,
  type TaskId,
  type TaskStatus,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';

export interface StageSummary {
  readonly stage: StageDef;
  readonly locked: boolean;
  readonly complete: boolean;
  readonly isFrontier: boolean;
  readonly isLast: boolean;
  readonly awaitingApproval: boolean;
  readonly canApprove: boolean;
  readonly progress: Progress;
}

export function summarizeStage(process: Process, state: WorkflowState, stage: StageDef): StageSummary {
  return {
    stage,
    locked: isStageLocked(state, stage.index),
    complete: isStageComplete(process, state, stage.index),
    isFrontier: stage.index === frontStage(process, state),
    isLast: stage.index === process.lastStageIndex,
    awaitingApproval: isAwaitingApproval(state, stage.index),
    canApprove: canApprove(state, stage.index, process),
    progress: stageProgress(process, state, stage.index),
  };
}

export function summarizeStages(process: Process, state: WorkflowState): readonly StageSummary[] {
  return process.stages.map((stage) => summarizeStage(process, state, stage));
}

export interface TaskRow {
  readonly task: TaskDef;
  readonly status: TaskStatus;
  readonly done: boolean;
  readonly rework: boolean;
  readonly toggle: WorkflowAction | null;
  readonly revokesApproval: number | null;
}

export function toggleAction(process: Process, state: WorkflowState, taskId: TaskId): WorkflowAction | null {
  const status = taskStatus(process, state, taskId);
  if (status === 'doing') return { type: 'completeTask', taskId };
  if (status === 'done' && reopenableTaskId(process, state) === taskId) return { type: 'reopenTask', taskId };
  return null;
}

export function taskRow(process: Process, state: WorkflowState, task: TaskDef): TaskRow {
  const status = taskStatus(process, state, task.id);
  const toggle = toggleAction(process, state, task.id);
  return {
    task,
    status,
    done: status === 'done',
    rework: isRework(process, state, task.id),
    toggle,
    revokesApproval: toggle?.type === 'reopenTask' ? approvalRevokedByReopen(process, state, task.id) : null,
  };
}

export function taskRows(process: Process, state: WorkflowState, stage: StageDef): readonly TaskRow[] {
  return stage.tasks.map((task) => taskRow(process, state, task));
}
