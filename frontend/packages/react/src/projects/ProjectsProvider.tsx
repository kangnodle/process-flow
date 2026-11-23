import { useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import type { Member } from '@process-flow/domain';
import type { ProjectRepository, UserRepository, WorkflowFocus, WorkRepository } from '@process-flow/application';
import {
  createMemberManagement,
  createProjectActions,
  createProjectLifecycle,
  createProjectManagement,
  createUserManagement,
  createWorkManagement,
  createWorkflowSwitch,
} from '@process-flow/runtime';
import { useWorkflowSelector, WorkflowStoreContext } from '../workflow/workflowContext';
import { ProjectsContext, type ProjectsContextValue } from './projectsContext';
import { useManagementQuery } from './useManagementQuery';

interface ProjectsProviderProps {
  readonly repository?: ProjectRepository;
  readonly users?: UserRepository;
  readonly work?: WorkRepository;
  readonly switchWorkflow: (workflowId: string | undefined, focus?: WorkflowFocus) => void;
  readonly children: ReactNode;
}

const NO_MEMBERS: readonly Member[] = [];

export function ProjectsProvider({ repository, ...props }: ProjectsProviderProps) {
  return repository ? <Projects repository={repository} {...props} /> : <>{props.children}</>;
}

function Projects({
  repository,
  users,
  work,
  switchWorkflow,
  children,
}: ProjectsProviderProps & { readonly repository: ProjectRepository }) {
  const workspace = useWorkflowSelector((value) => value.workspace);
  const workflowStore = useContext(WorkflowStoreContext);
  const projectId = workspace?.projectId;
  const workflowId = workspace?.id;
  const lifecycle = useMemo(() => createProjectLifecycle(), []);
  useLayoutEffect(() => {
    lifecycle.start();
    return lifecycle.stop;
  }, [lifecycle]);
  const projects = useMemo(() => createProjectManagement(repository), [repository]);
  const userManagement = useMemo(() => (users ? createUserManagement(users) : undefined), [users]);
  const memberManagement = useMemo(() => (users ? createMemberManagement(users) : undefined), [users]);
  const workManagement = useMemo(() => (work ? createWorkManagement(work) : undefined), [work]);
  const projectQuery = useMemo(() => projects.observeCurrent(), [projects]);
  const memberQuery = useMemo(() => memberManagement?.observeCurrent(), [memberManagement]);
  const projectState = useManagementQuery(projectQuery, projectId);
  const memberState = useManagementQuery(memberQuery, projectId);
  const openWorkflow = useMemo(
    () =>
      createWorkflowSwitch({
        scope: lifecycle,
        currentWorkflowId: () => workflowStore?.get().workspace?.id,
        flush: async () => (await workflowStore?.get().flush?.()) ?? true,
        canSwitch: () => workflowStore?.get().canSwitchWorkflow?.() ?? true,
        switchWorkflow,
      }),
    [lifecycle, workflowStore, switchWorkflow],
  );
  const actions = useMemo(
    () =>
      createProjectActions(projects, {
        scope: lifecycle,
        currentProjectId: () => workflowStore?.get().workspace?.projectId,
        projectChanged: projectQuery.replace,
        refreshWorkflow: async () => {
          await workflowStore?.get().reload?.();
        },
        clearWorkflow: () => switchWorkflow(undefined),
        openWorkflow,
      }),
    [projects, lifecycle, workflowStore, projectQuery, switchWorkflow, openWorkflow],
  );
  const loadedProject = 'data' in projectState ? projectState.data : undefined;
  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects: actions,
      ...(userManagement ? { users: userManagement } : {}),
      ...(memberManagement ? { memberManagement } : {}),
      ...(workManagement ? { work: workManagement } : {}),
      ...(loadedProject && loadedProject.id === projectId ? { currentProject: loadedProject } : {}),
      ...(projectState.status === 'failed' ? { currentProjectError: projectState.error } : {}),
      reloadCurrentProject: projectQuery.reload,
      members: 'data' in memberState ? (memberState.data ?? NO_MEMBERS) : NO_MEMBERS,
      ...(memberState.status === 'failed' ? { membersError: memberState.error } : {}),
      reloadMembers: memberQuery?.reload ?? (() => undefined),
      ...(workflowId ? { currentWorkflowId: workflowId } : {}),
      ...(projectId ? { currentProjectId: projectId } : {}),
      openWorkflow,
    }),
    [
      actions,
      openWorkflow,
      userManagement,
      memberManagement,
      workManagement,
      projectQuery,
      memberQuery,
      projectState,
      loadedProject,
      memberState,
      projectId,
      workflowId,
    ],
  );
  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
}
