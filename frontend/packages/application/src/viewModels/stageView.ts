import {
  firstTaskOf,
  getStage,
  getTask,
  isStageApproved,
  remainingInStage,
  type Process,
  type StageDef,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';
import { summarizeStage, taskRows, type StageSummary, type TaskRow } from './stageSummary';

export function selectStageAction(process: Process, stageIndex: number): WorkflowAction {
  return { type: 'selectTask', taskId: firstTaskOf(process, stageIndex).id };
}

export interface StagePrimary {
  readonly kind: 'restartCycle' | 'goNextStage' | 'approveStage';
  readonly blocked: boolean;
  readonly action: WorkflowAction;
}

export type StageMessage =
  | { readonly kind: 'processComplete' }
  | { readonly kind: 'awaitingApproval'; readonly nextStage: StageDef }
  | { readonly kind: 'remainingToFinish'; readonly remaining: number }
  | { readonly kind: 'remainingToApprove'; readonly remaining: number };

export interface StageViewModel extends StageSummary {
  readonly stageCount: number;
  readonly passed: boolean;
  readonly remaining: number;
  readonly nextStage: StageDef | undefined;
  readonly tasks: readonly TaskRow[];
  readonly previous: WorkflowAction | null;
  readonly primary: StagePrimary;
  readonly message: StageMessage | null;
}

export function buildStageViewModel(process: Process, state: WorkflowState): StageViewModel {
  const stageIndex = getTask(process, state.selectedTaskId).stageIndex;
  const stage = getStage(process, stageIndex);
  const summary = summarizeStage(process, state, stage);
  const remaining = remainingInStage(process, state, stageIndex);
  const nextStage = process.stages[stageIndex + 1];

  let primary: StagePrimary;
  if (summary.isLast) {
    primary = { kind: 'restartCycle', blocked: remaining > 0, action: selectStageAction(process, 0) };
  } else if (!summary.isFrontier) {
    primary = { kind: 'goNextStage', blocked: summary.locked, action: selectStageAction(process, stageIndex + 1) };
  } else {
    primary = { kind: 'approveStage', blocked: !summary.canApprove, action: { type: 'approveStage', stageIndex } };
  }

  let message: StageMessage | null = null;
  if (summary.isFrontier || summary.isLast) {
    if (remaining > 0) {
      message = summary.isLast ? { kind: 'remainingToFinish', remaining } : { kind: 'remainingToApprove', remaining };
    } else {
      message = summary.isLast || !nextStage ? { kind: 'processComplete' } : { kind: 'awaitingApproval', nextStage };
    }
  }

  return {
    ...summary,
    stageCount: process.stages.length,
    passed: isStageApproved(process, state, stageIndex),
    remaining,
    nextStage,
    tasks: taskRows(process, state, stage),
    previous: stageIndex === 0 ? null : selectStageAction(process, stageIndex - 1),
    primary,
    message,
  };
}
