import { createContext, useContext } from 'react';
import type { Member, Project } from '@process-flow/domain';
import type {
  MemberManagement,
  ProjectManagement,
  RequestErrorKind,
  UserManagement,
  WorkflowFocus,
  WorkManagement,
} from '@process-flow/application';
import { useWorkflowSelector } from '../workflow/workflowContext';

export interface ProjectsContextValue {
  readonly projects: ProjectManagement;
  readonly users?: UserManagement;
  readonly memberManagement?: MemberManagement;
  readonly currentProject?: Project;
  readonly currentProjectError?: RequestErrorKind;
  readonly reloadCurrentProject: () => void;
  readonly members: readonly Member[];
  readonly membersError?: RequestErrorKind;
  readonly reloadMembers: () => void;
  readonly currentWorkflowId?: string;
  readonly currentProjectId?: string;
  readonly work?: WorkManagement;
  readonly openWorkflow: (workflowId: string, focus?: WorkflowFocus) => Promise<void>;
}

export function useSwitchBlocked(): boolean {
  return useWorkflowSelector(
    (value) =>
      value.hasUnsavedChanges === true ||
      value.persistence === 'loading' ||
      Object.keys(value.conflictedDrafts ?? {}).length > 0,
  );
}

export const ProjectsContext = createContext<ProjectsContextValue | null>(null);
export function useProjects(): ProjectsContextValue | null {
  return useContext(ProjectsContext);
}
