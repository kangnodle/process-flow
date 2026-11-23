import type { Project, WorkflowSummary } from '@process-flow/domain';
import type { ProjectInput, ProjectPatch } from '../../ports/projectRepository';
import type { WorkflowFocus } from '../../ports/workflowRepository';
import type { ManagementQuery } from './managementQuery';

export interface ProjectDetail {
  readonly project: Project;
  readonly workflows: readonly WorkflowSummary[];
}

export interface ProjectManagement {
  observeList(): ManagementQuery<boolean, readonly Project[]>;
  observeDetail(): ManagementQuery<string, ProjectDetail>;
  observeCurrent(): ManagementQuery<string | undefined, Project | undefined>;
  create(input: ProjectInput): Promise<Project>;
  update(project: Project, patch: ProjectPatch): Promise<Project>;
  deleteArchived(project: Project): Promise<void>;
  startWorkflow(project: Project, name?: string): Promise<WorkflowSummary>;
}

export type ProjectMutation =
  | { readonly kind: 'update'; readonly patch: ProjectPatch }
  | { readonly kind: 'deleteArchived' }
  | { readonly kind: 'startWorkflow'; readonly name?: string };

export type ProjectOperationPlan =
  | { readonly kind: 'denied'; readonly error: 'forbidden' | 'conflict' }
  | {
      readonly kind: 'update';
      readonly projectId: string;
      readonly expectedVersion: number;
      readonly patch: ProjectPatch;
    }
  | { readonly kind: 'deleteArchived'; readonly projectId: string; readonly expectedVersion: number }
  | { readonly kind: 'startWorkflow'; readonly projectId: string; readonly name?: string };

export function planProjectOperation(project: Project, operation: ProjectMutation): ProjectOperationPlan {
  const permission = operation.kind === 'startWorkflow' ? 'workflow.start' : 'project.edit';
  if (!project.permissions.includes(permission)) return { kind: 'denied', error: 'forbidden' };
  if (
    (operation.kind === 'startWorkflow' && project.archived) ||
    (operation.kind === 'deleteArchived' && !project.archived)
  ) {
    return { kind: 'denied', error: 'conflict' };
  }
  switch (operation.kind) {
    case 'update':
      return { ...operation, projectId: project.id, expectedVersion: project.version };
    case 'deleteArchived':
      return { kind: 'deleteArchived', projectId: project.id, expectedVersion: project.version };
    case 'startWorkflow':
      return { ...operation, projectId: project.id };
  }
}

export interface ProjectEffectScope {
  capture(): number;
  isCurrent(generation: number): boolean;
}

export interface WorkflowSwitchPorts {
  readonly scope?: ProjectEffectScope;
  currentWorkflowId(): string | undefined;
  flush?(): Promise<boolean>;
  canSwitch?(): boolean;
  switchWorkflow(workflowId: string | undefined, focus?: WorkflowFocus): void;
}

export const planWorkflowSwitch = (current: string | undefined, target: string): 'unchanged' | 'flush' =>
  current === target ? 'unchanged' : 'flush';

export interface ProjectWorkspacePorts {
  readonly scope?: ProjectEffectScope;
  currentProjectId(): string | undefined;
  projectChanged(project: Project): void;
  refreshWorkflow?(): Promise<void>;
  clearWorkflow(): void;
  openWorkflow(workflowId: string): Promise<void>;
}

export type ProjectFollowUp =
  | { readonly kind: 'updated'; readonly updateCurrent: boolean; readonly refreshWorkflow: boolean }
  | { readonly kind: 'deleted'; readonly clearWorkflow: boolean }
  | { readonly kind: 'started'; readonly openWorkflow: true };

export function planProjectFollowUp(
  currentProjectId: string | undefined,
  projectId: string,
  operation: ProjectMutation,
): ProjectFollowUp {
  const current = projectId === currentProjectId;
  switch (operation.kind) {
    case 'update':
      return {
        kind: 'updated',
        updateCurrent: current,
        refreshWorkflow: current && operation.patch.archived !== undefined,
      };
    case 'deleteArchived':
      return { kind: 'deleted', clearWorkflow: current };
    case 'startWorkflow':
      return { kind: 'started', openWorkflow: true };
  }
}
