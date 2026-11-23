import { useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { STANDARD_PROCESS, STANDARD_PROCESS_TEXT } from '@process-flow/domain';
import type { Navigation, ProjectRepository, WorkflowRepository, WorkRepository } from '@process-flow/application';
import { createMemoryNavigation } from '@process-flow/runtime';
import {
  NavigationProvider,
  PreferencesProvider,
  ProjectsProvider,
  WorkflowProvider,
  WorkflowStoreContext,
} from '@process-flow/react';
import { AppShell, ProcessTextContext } from '@process-flow/ui';
import { createFakeBackend } from './fakeProjects';
import { createFakePlatform } from './fakePlatform';

function FlushBinding({ flush, children }: { readonly flush?: () => Promise<boolean>; readonly children: ReactNode }) {
  const store = useContext(WorkflowStoreContext);
  if (!store) throw new Error('Missing workflow store');
  const binding = useMemo(
    () => ({ subscribe: store.subscribe, get: () => ({ ...store.get(), ...(flush ? { flush } : {}) }) }),
    [store, flush],
  );
  return <WorkflowStoreContext.Provider value={binding}>{children}</WorkflowStoreContext.Provider>;
}

function BrowserWorkspace({
  repository,
  projects,
  navigation,
  newWorkflowId,
  newProjectId,
  flush,
  work,
}: {
  readonly repository: WorkflowRepository;
  readonly projects: ProjectRepository;
  readonly navigation: Navigation;
  readonly newWorkflowId: string;
  readonly newProjectId: string;
  readonly flush?: () => Promise<boolean>;
  readonly work?: WorkRepository;
}) {
  const [generation, setGeneration] = useState(0);
  const platform = useMemo(() => createFakePlatform(), []);
  const switchWorkflow = useCallback(
    (id: string | undefined) => {
      repository.switchTo?.(id);
      setGeneration((value) => value + 1);
    },
    [repository],
  );
  return (
    <FluentProvider theme={webLightTheme}>
      <NavigationProvider navigation={navigation}>
        <PreferencesProvider
          colorScheme={platform.colorScheme}
          preferredLanguages={['en']}
          initial={{ locale: 'en', theme: 'light' }}
        >
          <ProcessTextContext.Provider value={STANDARD_PROCESS_TEXT}>
            <button
              onClick={() => {
                switchWorkflow(newWorkflowId);
                navigation.push(`/projects/${newProjectId}`);
              }}
            >
              Open newer workspace
            </button>
            <WorkflowProvider
              key={generation}
              process={STANDARD_PROCESS}
              repository={repository}
              scheduler={platform.scheduler}
            >
              <FlushBinding {...(flush ? { flush } : {})}>
                <ProjectsProvider repository={projects} switchWorkflow={switchWorkflow} {...(work ? { work } : {})}>
                  <AppShell serviceName="Process Flow" projectName="Project" />
                </ProjectsProvider>
              </FlushBinding>
            </WorkflowProvider>
          </ProcessTextContext.Provider>
        </PreferencesProvider>
      </NavigationProvider>
    </FluentProvider>
  );
}

describe('project browser continuations', () => {
  it.each(['delete', 'start', 'open', 'work'] as const)(
    'preserves the newer browser route after a delayed %s',
    async (operation) => {
      const backend = createFakeBackend();
      if (operation === 'delete') await backend.projectRepository.update('first', 0, { archived: true });
      const oldTarget =
        operation === 'open' || operation === 'work'
          ? await backend.projectRepository.startWorkflow('first', 'Old target')
          : undefined;
      const newerProject = await backend.projectRepository.create({ name: 'New project' });
      const newerWorkflow = await backend.projectRepository.startWorkflow(newerProject.id, 'New workflow');
      let finish: (() => void) | undefined;
      const wait = () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        });
      const projects: ProjectRepository = {
        ...backend.projectRepository,
        deleteArchived: async (id, version) => {
          await wait();
          await backend.projectRepository.deleteArchived(id, version);
        },
        startWorkflow: async (id, name) => {
          await wait();
          return backend.projectRepository.startWorkflow(id, name);
        },
      };
      const flush =
        operation === 'open' || operation === 'work'
          ? async () => {
              await wait();
              return true;
            }
          : undefined;
      const navigation = createMemoryNavigation(operation === 'work' ? '/my-work' : '/projects/first');
      const work: WorkRepository = {
        mine: async () =>
          oldTarget
            ? [
                {
                  projectId: 'first',
                  projectName: 'Old project',
                  workflowId: oldTarget.id,
                  workflowName: 'Old target',
                  group: 'ready',
                  kind: 'task',
                  taskId: 'goals',
                  taskNumber: 1,
                  stageId: 'planning',
                  stageIndex: 0,
                  rework: false,
                },
              ]
            : [],
      };
      const user = userEvent.setup();
      render(
        <BrowserWorkspace
          repository={backend.workflowRepository}
          projects={projects}
          navigation={navigation}
          newWorkflowId={newerWorkflow.id}
          newProjectId={newerProject.id}
          work={work}
          {...(flush ? { flush } : {})}
        />,
      );
      if (operation !== 'work') await screen.findByRole('heading', { level: 1, name: '첫 프로젝트' });
      if (operation === 'delete') {
        await user.click(screen.getByRole('button', { name: 'Delete permanently' }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete permanently' }));
      } else if (operation === 'start') {
        await user.click(screen.getByRole('button', { name: 'Start' }));
      } else if (operation === 'open') {
        await user.click(screen.getByRole('button', { name: 'Open Old target' }));
      } else {
        await user.click(await screen.findByRole('button', { name: /Old target/ }));
      }
      expect(finish).toBeDefined();
      await user.click(screen.getByRole('button', { name: 'Open newer workspace' }));
      await screen.findByRole('heading', { level: 1, name: 'New project' });
      await act(async () => {
        finish?.();
      });
      expect(navigation.current()).toBe(`/projects/${newerProject.id}`);
      expect(backend.currentWorkflowId()).toBe(newerWorkflow.id);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'New project' })).toBeInTheDocument());
    },
  );
});

it('keeps the project route when a pending workflow flush fails', async () => {
  const backend = createFakeBackend();
  await backend.projectRepository.startWorkflow('first', 'Old target');
  let finish: ((saved: boolean) => void) | undefined;
  const flush = () =>
    new Promise<boolean>((resolve) => {
      finish = resolve;
    });
  const navigation = createMemoryNavigation('/projects/first');
  const user = userEvent.setup();
  render(
    <BrowserWorkspace
      repository={backend.workflowRepository}
      projects={backend.projectRepository}
      navigation={navigation}
      newWorkflowId="unused"
      newProjectId="unused"
      flush={flush}
    />,
  );
  await screen.findByRole('heading', { level: 1, name: '첫 프로젝트' });
  await user.click(screen.getByRole('button', { name: 'Open Old target' }));
  await act(async () => {
    finish?.(false);
  });
  expect(navigation.current()).toBe('/projects/first');
  expect(backend.currentWorkflowId()).toBe('wf-first');
});
