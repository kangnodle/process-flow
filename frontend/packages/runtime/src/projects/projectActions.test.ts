import { describe, expect, it } from 'vitest';
import type { ProjectManagement, ProjectWorkspacePorts } from '@process-flow/application';
import { PERMISSIONS, type Project } from '@process-flow/domain';
import { createProjectLifecycle } from './projectLifecycle';
import { createProjectActions } from './projectActions';

const project: Project = {
  id: 'project',
  name: '',
  description: '',
  version: 0,
  archived: false,
  role: 'owner',
  permissions: PERMISSIONS,
};
function setup() {
  const events: string[] = [];
  const management = {
    update: async () => {
      events.push('update');
      return { ...project, version: 1 };
    },
    deleteArchived: async () => {
      events.push('delete');
    },
    startWorkflow: async () => {
      events.push('start');
      return { id: 'started', name: '', projectId: project.id, phase: { kind: 'finished' } };
    },
  } as unknown as ProjectManagement;
  const ports: ProjectWorkspacePorts = {
    currentProjectId: () => project.id,
    projectChanged: () => {
      events.push('changed');
    },
    refreshWorkflow: async () => {
      events.push('refresh');
    },
    clearWorkflow: () => {
      events.push('clear');
    },
    openWorkflow: async () => {
      events.push('open');
    },
  };
  return { actions: createProjectActions(management, ports), events };
}

describe('project workspace actions', () => {
  it('updates current project metadata before refreshing workflow permissions after archiving', async () => {
    const { actions, events } = setup();
    await actions.update(project, { archived: true });
    expect(events).toEqual(['update', 'changed', 'refresh']);
  });
  it('opens a workflow only after starting it', async () => {
    const { actions, events } = setup();
    await actions.startWorkflow(project, 'New');
    expect(events).toEqual(['start', 'open']);
  });
  it('clears the current workflow after deleting its project', async () => {
    const { actions, events } = setup();
    await actions.deleteArchived({ ...project, archived: true });
    expect(events).toEqual(['delete', 'clear']);
  });
  it('does not refresh or replace a newer project after an older update finishes', async () => {
    let currentProjectId = project.id;
    let finish: (() => void) | undefined;
    const events: string[] = [];
    const management = {
      update: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { ...project, archived: true };
      },
    } as unknown as ProjectManagement;
    const actions = createProjectActions(management, {
      currentProjectId: () => currentProjectId,
      projectChanged: () => {
        events.push('changed');
      },
      refreshWorkflow: async () => {
        events.push('refresh');
      },
      clearWorkflow: () => undefined,
      openWorkflow: async () => undefined,
    });
    const updating = actions.update(project, { archived: true });
    currentProjectId = 'other';
    finish?.();
    await updating;
    expect(events).toEqual([]);
  });
  it('discards a completion from a stopped lifecycle even after the lifecycle starts again', async () => {
    const scope = createProjectLifecycle();
    scope.start();
    let finish: (() => void) | undefined;
    let cleared = false;
    const management = {
      deleteArchived: async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    } as unknown as ProjectManagement;
    const actions = createProjectActions(management, {
      scope,
      currentProjectId: () => project.id,
      projectChanged: () => undefined,
      clearWorkflow: () => {
        cleared = true;
      },
      openWorkflow: async () => undefined,
    });
    const deleting = actions.deleteArchived({ ...project, archived: true });
    scope.stop();
    scope.start();
    finish?.();
    await expect(deleting).rejects.toMatchObject({ kind: 'conflict' });
    expect(cleared).toBe(false);
  });
});
