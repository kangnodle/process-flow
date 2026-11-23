import type { Project, WorkflowSummary } from '@process-flow/domain';

export interface ProjectInput {
  readonly name: string;
  readonly description?: string;
}
export interface ProjectPatch {
  readonly name?: string;
  readonly description?: string;
  readonly archived?: boolean;
}

export interface ProjectRepository {
  list(includeArchived: boolean): Promise<readonly Project[]>;
  get(id: string): Promise<Project>;
  create(input: ProjectInput): Promise<Project>;
  update(id: string, expectedVersion: number, patch: ProjectPatch): Promise<Project>;
  deleteArchived(id: string, expectedVersion: number): Promise<void>;
  workflows(projectId: string): Promise<readonly WorkflowSummary[]>;
  startWorkflow(projectId: string, name?: string): Promise<WorkflowSummary>;
}
