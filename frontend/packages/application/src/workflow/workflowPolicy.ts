import {
  authorityOf,
  changesWorkflow,
  type PersistentAction,
  type Process,
  type WorkflowAction,
  type WorkflowAuthority,
  type WorkflowState,
} from '@process-flow/domain';
import type { WorkspacePreferences } from '../ports';

export type WorkflowSessionStatus = 'loading' | 'empty' | 'saved' | 'saving' | 'error';

export function restoreWorkflowView(
  process: Process,
  state: WorkflowState,
  preferences: WorkspacePreferences,
): WorkflowState {
  const { view, selectedTaskId } = preferences;
  const knownTask = selectedTaskId && process.tasks.some((task) => task.id === selectedTaskId);
  return {
    ...state,
    ...(view ? { view } : {}),
    ...(knownTask ? { selectedTaskId } : {}),
  };
}

export function workflowViewChanges(previous: WorkflowState, next: WorkflowState): WorkspacePreferences {
  return {
    ...(next.view !== previous.view ? { view: next.view } : {}),
    ...(next.selectedTaskId !== previous.selectedTaskId ? { selectedTaskId: next.selectedTaskId } : {}),
  };
}

export function canDispatchWorkflowAction(
  process: Process,
  action: WorkflowAction,
  status: WorkflowSessionStatus,
  canExecute: boolean,
  authority: WorkflowAuthority | undefined,
  queue: readonly PersistentAction[],
): boolean {
  if (status === 'loading' || status === 'empty') return false;
  if (changesWorkflow(action) && (status === 'error' || !canExecute)) return false;
  if (
    (action.type === 'completeTask' || action.type === 'completeAndNext') &&
    queue.some((item) => item.type === 'updateRecord' && item.taskId === action.taskId)
  ) {
    return false;
  }
  return authorityOf(process, authority, action) !== null;
}

export function enqueueWorkflowAction(
  queue: readonly PersistentAction[],
  action: PersistentAction,
  sending: boolean,
): readonly PersistentAction[] {
  const last = queue.at(-1);
  if (
    action.type === 'updateRecord' &&
    last?.type === 'updateRecord' &&
    (!sending || queue.length > 1) &&
    last.taskId === action.taskId
  ) {
    return [...queue.slice(0, -1), { ...action, patch: { ...last.patch, ...action.patch } }];
  }
  return [...queue, action];
}

export function reconcileWorkflowState(
  saved: WorkflowState,
  current: WorkflowState,
  queue: readonly PersistentAction[],
  reduce: (state: WorkflowState, action: WorkflowAction) => WorkflowState,
): WorkflowState {
  const { view, selectedTaskId } = current;
  const state = queue.reduce(reduce, { ...saved, view, selectedTaskId });
  return { ...state, view, selectedTaskId };
}
