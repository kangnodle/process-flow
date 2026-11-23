import {
  RequestError,
  planProjectOperation,
  planWorkflowSwitch,
  type ProjectManagement,
  type ProjectRepository,
  type WorkflowSwitchPorts,
  type WorkflowFocus,
} from '@process-flow/application';
import { createManagementQuery } from './managementQuery';

export function createProjectManagement(repository: ProjectRepository): ProjectManagement {
  return {
    observeList: () => createManagementQuery((includeArchived) => repository.list(includeArchived)),
    observeDetail: () =>
      createManagementQuery(async (projectId) => {
        const [project, workflows] = await Promise.all([repository.get(projectId), repository.workflows(projectId)]);
        return { project, workflows };
      }),
    observeCurrent: () =>
      createManagementQuery(async (projectId) => (projectId ? repository.get(projectId) : undefined)),
    create: (input) => repository.create(input),
    update: async (project, patch) => {
      const plan = planProjectOperation(project, { kind: 'update', patch });
      if (plan.kind !== 'update')
        throw new RequestError(plan.kind === 'denied' ? plan.error : 'invalid', 'Project update denied');
      return repository.update(plan.projectId, plan.expectedVersion, plan.patch);
    },
    deleteArchived: async (project) => {
      const plan = planProjectOperation(project, { kind: 'deleteArchived' });
      if (plan.kind !== 'deleteArchived')
        throw new RequestError(plan.kind === 'denied' ? plan.error : 'invalid', 'Project deletion denied');
      await repository.deleteArchived(plan.projectId, plan.expectedVersion);
    },
    startWorkflow: async (project, name) => {
      const plan = planProjectOperation(project, { kind: 'startWorkflow', ...(name !== undefined ? { name } : {}) });
      if (plan.kind !== 'startWorkflow')
        throw new RequestError(plan.kind === 'denied' ? plan.error : 'invalid', 'Workflow start denied');
      return repository.startWorkflow(plan.projectId, plan.name);
    },
  };
}

export function createWorkflowSwitch(
  ports: WorkflowSwitchPorts,
): (target: string, focus?: WorkflowFocus) => Promise<void> {
  return async (target, focus) => {
    const generation = ports.scope?.capture();
    const current = () => !ports.scope || (generation !== undefined && ports.scope.isCurrent(generation));
    const assertCurrent = () => {
      if (!current()) throw new RequestError('conflict', 'Project workspace is no longer active');
    };
    assertCurrent();
    if (planWorkflowSwitch(ports.currentWorkflowId(), target) === 'unchanged') return;
    const flushed = ports.flush ? await ports.flush() : true;
    assertCurrent();
    if (!flushed || (ports.canSwitch && !ports.canSwitch()))
      throw new RequestError('conflict', 'Resolve unsaved changes before switching workflows');
    ports.switchWorkflow(target, focus);
  };
}
