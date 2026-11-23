import { useCallback, useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { STANDARD_PROCESS, type Project } from '@process-flow/domain';
import { RequestError, type ProjectRepository, type WorkflowRepository } from '@process-flow/application';
import { ProjectsProvider, WorkflowProvider, useProjects, useWorkflow } from '@process-flow/react';
import { createFakeBackend } from './fakeProjects';
import { createFakePlatform } from './fakePlatform';

type Operation = 'archive' | 'delete' | 'start';

function ProjectControls({ project, operation }: { readonly project: Project; readonly operation: Operation }) {
  const projects = useProjects();
  const workflow = useWorkflow();
  const run = async () => {
    if (!projects) return;
    try {
      switch (operation) {
        case 'archive':
          await projects.projects.update(project, { archived: true });
          break;
        case 'delete':
          await projects.projects.deleteArchived(project);
          break;
        case 'start':
          await projects.projects.startWorkflow(project, 'Late workflow');
          break;
      }
    } catch (error) {
      if (!(error instanceof RequestError) || error.kind !== 'conflict') throw error;
    }
  };
  return (
    <>
      <output aria-label="Current workflow">{projects?.currentWorkflowId ?? 'none'}</output>
      <output aria-label="Persistence">{workflow.persistence}</output>
      <button onClick={() => void run()}>Run old operation</button>
    </>
  );
}

function KeyedProjectWorkspace({
  project,
  operation,
  repository,
  projects,
  nextWorkflowId,
  switched,
}: {
  readonly project: Project;
  readonly operation: Operation;
  readonly repository: WorkflowRepository;
  readonly projects: ProjectRepository;
  readonly nextWorkflowId: string;
  readonly switched: (id: string | undefined) => void;
}) {
  const [generation, setGeneration] = useState(0);
  const switchWorkflow = useCallback(
    (id: string | undefined) => {
      switched(id);
      repository.switchTo?.(id);
      setGeneration((value) => value + 1);
    },
    [repository, switched],
  );
  return (
    <>
      <button onClick={() => switchWorkflow(nextWorkflowId)}>Open newer workflow</button>
      <WorkflowProvider
        key={generation}
        process={STANDARD_PROCESS}
        repository={repository}
        scheduler={createFakePlatform().scheduler}
      >
        <ProjectsProvider repository={projects} switchWorkflow={switchWorkflow}>
          <ProjectControls project={project} operation={operation} />
        </ProjectsProvider>
      </WorkflowProvider>
    </>
  );
}

describe('project provider lifecycle', () => {
  it.each<Operation>(['delete', 'archive', 'start'])(
    'ignores %s followups after a keyed workspace remount',
    async (operation) => {
      const backend = createFakeBackend();
      let project = await backend.projectRepository.get('first');
      if (operation === 'delete')
        project = await backend.projectRepository.update(project.id, project.version, { archived: true });
      const newerProject = await backend.projectRepository.create({ name: 'New project' });
      const newerWorkflow = await backend.projectRepository.startWorkflow(newerProject.id, 'New workflow');
      let finish: (() => void) | undefined;
      const waitForFinish = () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        });
      const switches: (string | undefined)[] = [];
      const opened: (string | undefined)[] = [];
      const repository: WorkflowRepository = {
        ...backend.workflowRepository,
        open: async () => {
          const saved = await backend.workflowRepository.open();
          opened.push(saved?.id);
          return saved;
        },
      };
      const projects: ProjectRepository = {
        ...backend.projectRepository,
        update: async (id, version, patch) => {
          await waitForFinish();
          return backend.projectRepository.update(id, version, patch);
        },
        deleteArchived: async (id, version) => {
          await waitForFinish();
          await backend.projectRepository.deleteArchived(id, version);
        },
        startWorkflow: async (id, name) => {
          await waitForFinish();
          return backend.projectRepository.startWorkflow(id, name);
        },
      };
      const user = userEvent.setup();
      render(
        <KeyedProjectWorkspace
          project={project}
          operation={operation}
          repository={repository}
          projects={projects}
          nextWorkflowId={newerWorkflow.id}
          switched={(id) => switches.push(id)}
        />,
      );
      await waitFor(() => expect(screen.getByLabelText('Current workflow')).toHaveTextContent('wf-first'));
      await user.click(screen.getByRole('button', { name: 'Run old operation' }));
      expect(finish).toBeDefined();
      await user.click(screen.getByRole('button', { name: 'Open newer workflow' }));
      await waitFor(() => expect(screen.getByLabelText('Current workflow')).toHaveTextContent(newerWorkflow.id));
      await act(async () => {
        finish?.();
      });
      expect(screen.getByLabelText('Current workflow')).toHaveTextContent(newerWorkflow.id);
      expect(backend.currentWorkflowId()).toBe(newerWorkflow.id);
      expect(switches).toEqual([newerWorkflow.id]);
      expect(opened).toEqual(['wf-first', newerWorkflow.id]);
    },
  );
});
