import type { Permission, Role } from './access';
import type { Phase } from './workflow/phase';

export interface Project {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly archived: boolean;
  readonly version: number;
  readonly role: Role;
  readonly permissions: readonly Permission[];
}

export interface WorkflowSummary {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly phase: Phase;
}
