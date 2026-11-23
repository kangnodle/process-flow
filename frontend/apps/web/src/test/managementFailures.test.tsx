import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RequestError } from '@process-flow/application';
import { App } from '../App';
import { createFakeBackend } from './fakeProjects';
import { createFakePlatform } from './fakePlatform';

describe('management failures', () => {
  it('shows saved user metadata when password reset fails and allows another edit', async () => {
    const backend = createFakeBackend();
    await backend.userRepository.create({ email: 'kim@example.com', name: 'Before', password: 'password1' });
    const user = userEvent.setup();
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: backend.projectRepository,
          userRepository: {
            ...backend.userRepository,
            setPassword: async () => {
              throw new RequestError('unknown', 'offline');
            },
          },
        }}
        initialPreferences={{ locale: 'en', theme: 'light' }}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: '첫 워크플로' });
    await user.click(screen.getByRole('button', { name: 'Users' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Before' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Saved');
    await user.type(screen.getByLabelText(/^New password/), 'new-password');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'User details were saved, but the password could not be changed. Edit the user to retry.',
      ),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Edit Saved' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('button', { name: 'Edit Saved' })).toBeInTheDocument();
    expect((await backend.userRepository.list(false))[0]?.name).toBe('Saved');
  });

  it('exposes current project and member load failures with retry', async () => {
    const backend = createFakeBackend();
    let fails = true;
    const user = userEvent.setup();
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: {
            ...backend.projectRepository,
            get: async (id) => {
              if (fails) throw new Error('offline');
              return backend.projectRepository.get(id);
            },
          },
          userRepository: {
            ...backend.userRepository,
            members: async (id) => {
              if (fails) throw new Error('offline');
              return backend.userRepository.members(id);
            },
          },
        }}
        initialPreferences={{ locale: 'en', theme: 'light' }}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: '첫 워크플로' });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(await screen.findByText('The current project could not be loaded.')).toBeInTheDocument();
    fails = false;
    const error =
      screen.getByText('The current project could not be loaded.').closest('[role="group"]') ??
      screen.getByText('The current project could not be loaded.').parentElement?.parentElement;
    if (!error) throw new Error('Expected retry container');
    await user.click(within(error as HTMLElement).getByRole('button', { name: 'Try again' }));
    await user.click(screen.getByRole('button', { name: 'Process Flow · Home' }));
    expect(await screen.findByText('Project · 첫 프로젝트')).toBeInTheDocument();
  });
  it('shows member load failures on assignments and retries the members', async () => {
    const backend = createFakeBackend();
    const member = await backend.userRepository.create({
      email: 'kim@example.com',
      name: 'Kim',
      password: 'password1',
    });
    await backend.userRepository.putMember('first', member.id, 'owner');
    let fails = true;
    const requests: boolean[] = [];
    const user = userEvent.setup();
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: backend.projectRepository,
          userRepository: {
            ...backend.userRepository,
            members: async (id) => {
              requests.push(fails);
              if (fails) throw new Error('offline');
              return backend.userRepository.members(id);
            },
          },
        }}
        initialPreferences={{ locale: 'en', theme: 'light' }}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: '첫 워크플로' });
    await user.click(screen.getByRole('button', { name: 'Assignments' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    const message = await screen.findByText('Project members could not be loaded.');
    const group = message.closest('[role="group"]');
    if (!group) throw new Error('Expected retry container');
    fails = false;
    await user.click(within(group as HTMLElement).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('rowheader', { name: 'Kim' })).toBeInTheDocument();
  });
  it('keeps the newer user filter and saved metadata when a delayed edit finishes', async () => {
    const backend = createFakeBackend();
    await backend.userRepository.create({ email: 'active@example.com', name: 'Before', password: 'password1' });
    const inactive = await backend.userRepository.create({
      email: 'inactive@example.com',
      name: 'Inactive user',
      password: 'password1',
    });
    await backend.userRepository.update(inactive.id, inactive.version, { active: false });
    let finishEdit: (() => void) | undefined;
    let failRefresh = false;
    const user = userEvent.setup();
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: backend.projectRepository,
          userRepository: {
            ...backend.userRepository,
            update: async (id, version, patch) => {
              await new Promise<void>((resolve) => {
                finishEdit = resolve;
              });
              return backend.userRepository.update(id, version, patch);
            },
            list: async (includeInactive) => {
              if (failRefresh) throw new Error('offline');
              return backend.userRepository.list(includeInactive);
            },
          },
        }}
        initialPreferences={{ locale: 'en', theme: 'light' }}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: '첫 워크플로' });
    await user.click(screen.getByRole('button', { name: 'Users' }));
    await user.click(await screen.findByRole('button', { name: 'Edit Before' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(name);
    await user.type(name, 'Saved');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('switch', { name: 'Show inactive users' }));
    await screen.findByText('Inactive user');
    failRefresh = true;
    await act(async () => {
      finishEdit?.();
    });
    expect(await screen.findByRole('button', { name: 'Edit Saved' })).toBeInTheDocument();
    expect(screen.getByText('Inactive user')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show inactive users' })).toBeChecked();
  });

  it('offers retry when a project reload fails while retained details stay visible', async () => {
    const backend = createFakeBackend();
    let failLoad = false;
    const user = userEvent.setup();
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: {
            ...backend.projectRepository,
            get: async (id) => {
              if (failLoad) throw new RequestError('forbidden', 'denied');
              return backend.projectRepository.get(id);
            },
            update: async () => {
              throw new RequestError('versionConflict', 'stale');
            },
          },
        }}
        initialPreferences={{ locale: 'en', theme: 'light' }}
      />,
    );
    await screen.findByRole('heading', { level: 1, name: '첫 워크플로' });
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    await user.click(await screen.findByRole('button', { name: /첫 프로젝트/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    failLoad = true;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const retries = await screen.findAllByRole('button', { name: 'Try again' });
    expect(retries).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: '첫 프로젝트' })).toBeInTheDocument();
    failLoad = false;
    await user.click(retries[0]!);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument());
  });
});
