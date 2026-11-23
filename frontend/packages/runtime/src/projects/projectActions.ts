import {
  RequestError,
  planProjectFollowUp,
  type ProjectManagement,
  type ProjectWorkspacePorts,
} from '@process-flow/application';

export function createProjectActions(management: ProjectManagement, ports: ProjectWorkspacePorts): ProjectManagement {
  const capture = () => {
    if (!ports.scope) return undefined;
    const generation = ports.scope.capture();
    if (!ports.scope.isCurrent(generation)) throw new RequestError('conflict', 'Project workspace is no longer active');
    return generation;
  };
  const current = (generation: number | undefined) =>
    !ports.scope || (generation !== undefined && ports.scope.isCurrent(generation));
  const assertCurrent = (generation: number | undefined) => {
    if (!current(generation)) throw new RequestError('conflict', 'Project workspace is no longer active');
  };
  return {
    ...management,
    update: async (project, patch) => {
      const generation = capture();
      const updated = await management.update(project, patch);
      assertCurrent(generation);
      const followUp = planProjectFollowUp(ports.currentProjectId(), project.id, { kind: 'update', patch });
      if (followUp.kind === 'updated') {
        if (followUp.updateCurrent) ports.projectChanged(updated);
        if (followUp.refreshWorkflow) {
          assertCurrent(generation);
          await ports.refreshWorkflow?.();
        }
      }
      return updated;
    },
    deleteArchived: async (project) => {
      const generation = capture();
      await management.deleteArchived(project);
      assertCurrent(generation);
      const followUp = planProjectFollowUp(ports.currentProjectId(), project.id, { kind: 'deleteArchived' });
      if (followUp.kind === 'deleted' && followUp.clearWorkflow) ports.clearWorkflow();
    },
    startWorkflow: async (project, name) => {
      const generation = capture();
      const followUp = planProjectFollowUp(ports.currentProjectId(), project.id, { kind: 'startWorkflow' });
      const started = await management.startWorkflow(project, name);
      assertCurrent(generation);
      if (followUp.kind === 'started') await ports.openWorkflow(started.id);
      return started;
    },
  };
}
