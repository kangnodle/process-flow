import {
  frontStage,
  getStage,
  getTask,
  previousTask,
  reworkPreview,
  type Process,
  type ReworkPreview,
  type StageDef,
  type TaskDef,
  type WorkflowState,
} from '@process-flow/domain';
import { summarizeStages, taskRow, taskRows, type StageSummary, type TaskRow } from './stageSummary';
import { blockedReason, type TaskBlock } from './taskBlock';

export type ColumnHint =
  | { readonly kind: 'unlocksAfter'; readonly stageIndex: number }
  | { readonly kind: 'allStagesDone' }
  | { readonly kind: 'awaitingApproval' }
  | { readonly kind: 'tasksLeft'; readonly count: number };

export interface BoardColumn extends StageSummary {
  readonly hint: ColumnHint | null;
  readonly tasks: readonly TaskRow[];
}

export interface BoardSelection extends TaskRow {
  readonly stage: StageDef;
  readonly locked: boolean;
  readonly previous: TaskDef | undefined;
  readonly blocked: TaskBlock | null;
  readonly reworkPreview: ReworkPreview | null;
}

export interface BoardViewModel {
  readonly current: StageDef;
  readonly columns: readonly BoardColumn[];
  readonly selected: BoardSelection;
}

function columnHint(summary: StageSummary): ColumnHint | null {
  if (summary.locked) return { kind: 'unlocksAfter', stageIndex: summary.stage.index };
  if (summary.isFrontier && summary.complete && summary.isLast) return { kind: 'allStagesDone' };
  if (summary.awaitingApproval) return { kind: 'awaitingApproval' };
  if (summary.isFrontier && !summary.complete) {
    return { kind: 'tasksLeft', count: summary.progress.total - summary.progress.done };
  }
  return null;
}

export function buildBoardViewModel(process: Process, state: WorkflowState): BoardViewModel {
  const selected = getTask(process, state.selectedTaskId);
  const row = taskRow(process, state, selected);
  return {
    current: getStage(process, frontStage(process, state)),
    columns: summarizeStages(process, state).map((summary) => ({
      ...summary,
      hint: columnHint(summary),
      tasks: taskRows(process, state, summary.stage),
    })),
    selected: {
      ...row,
      stage: getStage(process, selected.stageIndex),
      locked: row.status === 'locked',
      previous: previousTask(process, selected.id),
      blocked: blockedReason(process, state, selected),
      reworkPreview: reworkPreview(process, state, selected.id),
    },
  };
}
