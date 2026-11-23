import {
  getTask,
  currentTaskId,
  reopenableTaskId,
  taskStatus,
  type Process,
  type TaskDef,
  type WorkflowState,
} from '@process-flow/domain';

export type TaskBlock =
  | { readonly kind: 'stageLocked'; readonly stageIndex: number }
  | { readonly kind: 'waitForPrevious'; readonly due: TaskDef }
  | { readonly kind: 'onlyLastReopenable'; readonly last: TaskDef };

export function blockedReason(process: Process, state: WorkflowState, task: TaskDef): TaskBlock | null {
  switch (taskStatus(process, state, task.id)) {
    case 'doing':
      return null;
    case 'locked':
      return { kind: 'stageLocked', stageIndex: task.stageIndex };
    case 'todo': {
      const due = currentTaskId(process, state);
      return due ? { kind: 'waitForPrevious', due: getTask(process, due) } : null;
    }
    case 'done': {
      const last = reopenableTaskId(process, state);
      return last && last !== task.id ? { kind: 'onlyLastReopenable', last: getTask(process, last) } : null;
    }
  }
}
