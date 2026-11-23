import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { STANDARD_PROCESS, createInitialState, createWorkflowReducer } from '@process-flow/domain';
import {
  RequestError,
  type ProjectRepository,
  type SavedWorkflow,
  type WorkflowRepository,
} from '@process-flow/application';
import { ProjectsProvider, WorkflowProvider, useProjects, useWorkflow } from '@process-flow/react';
import { createFakePlatform } from './fakePlatform';

function RecoveryControls() {
  const workflow = useWorkflow();
  const projects = useProjects();
  return (
    <>
      <output>{workflow.persistence}</output>
      <output>{workflow.conflictedDrafts?.goals ? 'Archived draft' : 'No archive'}</output>
      <button
        onClick={() => workflow.dispatch({ type: 'updateRecord', taskId: 'goals', patch: { note: 'Local decision' } })}
      >
        Edit
      </button>
      <button onClick={() => void workflow.flush?.()}>Save</button>
      <button onClick={() => void workflow.reload?.()}>Reload</button>
      <button
        onClick={() => {
          workflow.restoreDraft?.('goals');
          void workflow.flush?.();
        }}
      >
        Restore
      </button>
      <button
        onClick={() =>
          void projects?.openWorkflow('other').catch((error: unknown) => {
            if (!(error instanceof RequestError) || error.kind !== 'conflict') throw error;
          })
        }
      >
        Switch workflow
      </button>
    </>
  );
}

it('blocks switching with an archived draft and allows switching after restoration is acknowledged', async () => {
  let stored: SavedWorkflow = { id: 'current', version: 0, state: createInitialState(STANDARD_PROCESS) };
  let rejectSave = true;
  const reduce = createWorkflowReducer(STANDARD_PROCESS);
  const repository: WorkflowRepository = {
    open: async () => stored,
    execute: async (_id, version, action) => {
      if (rejectSave) throw new Error('version conflict');
      stored = { ...stored, version: version + 1, state: reduce(stored.state, action) };
      return stored;
    },
  };
  const unavailable = async (): Promise<never> => {
    throw new Error('Not used in this scenario');
  };
  const projects: ProjectRepository = {
    list: async () => [],
    get: unavailable,
    create: unavailable,
    update: unavailable,
    deleteArchived: unavailable,
    workflows: async () => [],
    startWorkflow: unavailable,
  };
  const switchWorkflow = vi.fn();
  render(
    <WorkflowProvider process={STANDARD_PROCESS} repository={repository} scheduler={createFakePlatform().scheduler}>
      <ProjectsProvider repository={projects} switchWorkflow={switchWorkflow}>
        <RecoveryControls />
      </ProjectsProvider>
    </WorkflowProvider>,
  );
  const user = userEvent.setup();
  await screen.findByText('saved');
  await user.click(screen.getByRole('button', { name: 'Edit' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('error');
  await user.click(screen.getByRole('button', { name: 'Reload' }));
  await screen.findByText('Archived draft');
  await screen.findByText('saved');
  await user.click(screen.getByRole('button', { name: 'Switch workflow' }));
  expect(switchWorkflow).not.toHaveBeenCalled();
  rejectSave = false;
  await user.click(screen.getByRole('button', { name: 'Restore' }));
  await screen.findByText('No archive');
  expect(stored.state.records.goals?.note).toBe('Local decision');
  await user.click(screen.getByRole('button', { name: 'Switch workflow' }));
  await waitFor(() => expect(switchWorkflow).toHaveBeenCalledWith('other', undefined));
});
