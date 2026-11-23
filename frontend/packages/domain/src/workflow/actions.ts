import type { WorkflowAction } from './state';

export const changesWorkflow = (action: WorkflowAction): boolean =>
  action.type !== 'setView' && action.type !== 'selectTask';

export type PersistentAction = Exclude<WorkflowAction, { type: 'setView' | 'selectTask' }>;
