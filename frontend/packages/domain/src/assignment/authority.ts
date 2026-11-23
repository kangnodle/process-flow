import type { Process } from '../process/model';
import type { WorkflowAction } from '../workflow/state';
import { NO_ASSIGNMENTS, type Assignments, type Authority, type WorkflowAuthority } from './model';
import { changesWorkflow } from '../workflow/actions';

export type ActionTarget =
  | { readonly kind: 'task'; readonly id: string }
  | { readonly kind: 'stage'; readonly id: string };

export function actionTarget(process: Process, action: WorkflowAction): ActionTarget | null {
  switch (action.type) {
    case 'completeTask':
    case 'completeAndNext':
    case 'reopenTask':
    case 'updateRecord':
      return { kind: 'task', id: action.taskId };
    case 'approveStage': {
      const stage = process.stages[action.stageIndex];
      return stage ? { kind: 'stage', id: stage.id } : null;
    }
    case 'requestRework': {
      const task = process.taskById.get(action.taskId);
      return task ? { kind: 'stage', id: task.stageId } : null;
    }
    case 'setView':
    case 'selectTask':
      return null;
  }
}

export const targetKey = (target: ActionTarget): string => `${target.kind}:${target.id}`;

export function authorityOf(
  process: Process,
  authority: WorkflowAuthority | undefined,
  action: WorkflowAction,
): Authority | null {
  if (!changesWorkflow(action) || !authority) return 'open';
  const target = actionTarget(process, action);
  if (!target) return 'open';
  const found = target.kind === 'task' ? authority.tasks[target.id] : authority.stages[target.id];
  return found === undefined ? 'open' : found;
}

export function responsibleFor(process: Process, assignments: Assignments, taskId: string): readonly string[] {
  const own = assignments.tasks.find((task) => task.taskId === taskId)?.responsible ?? [];
  if (own.length > 0) return own;
  const stageId = process.taskById.get(taskId)?.stageId;
  return assignments.stages.find((stage) => stage.stageId === stageId)?.responsible ?? [];
}

export function accountableFor(assignments: Assignments, stageId: string): string | undefined {
  return assignments.stages.find((stage) => stage.stageId === stageId)?.accountable;
}

export type ActionBlock =
  | { readonly kind: 'readOnly' }
  | { readonly kind: 'notResponsible'; readonly users: readonly string[] }
  | { readonly kind: 'notAccountable'; readonly user: string | undefined };

export function blockOf(
  process: Process,
  access: {
    readonly readOnly: boolean;
    readonly authority: WorkflowAuthority | undefined;
    readonly assignments: Assignments | undefined;
  },
  action: WorkflowAction,
): ActionBlock | null {
  if (!changesWorkflow(action)) return null;
  if (access.readOnly) return { kind: 'readOnly' };
  if (authorityOf(process, access.authority, action) !== null) return null;
  const target = actionTarget(process, action);
  const assignments = access.assignments ?? NO_ASSIGNMENTS;
  return target?.kind === 'task'
    ? { kind: 'notResponsible', users: responsibleFor(process, assignments, target.id) }
    : { kind: 'notAccountable', user: target ? accountableFor(assignments, target.id) : undefined };
}

export function assigneesOf(process: Process, assignments: Assignments | undefined, action: WorkflowAction) {
  const target = actionTarget(process, action);
  if (!target) return [];
  const all = assignments ?? NO_ASSIGNMENTS;
  if (target.kind === 'task') return responsibleFor(process, all, target.id);
  const accountable = accountableFor(all, target.id);
  return accountable ? [accountable] : [];
}
