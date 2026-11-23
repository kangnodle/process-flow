import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createInitialState, STANDARD_PROCESS } from '@process-flow/domain';
import type { WorkflowRepository } from '@process-flow/application';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';

it('applies recovered untouched language theme and task selection after a preference read retry', async () => {
  let loads = 0;
  const stored = { id: 'one', version: 0, state: createInitialState(STANDARD_PROCESS) };
  const repository: WorkflowRepository = {
    open: async () =>
      ++loads === 1
        ? { ...stored, preferences: {}, preferencesLoadError: 'unknown' }
        : { ...stored, preferences: { locale: 'en', theme: 'dark', view: 'task', selectedTaskId: 'user-research' } },
    execute: vi.fn(),
  };
  const user = userEvent.setup();
  render(<App platform={{ ...createFakePlatform(), workflowRepository: repository }} />);
  await screen.findByText('저장 완료');
  await user.click(screen.getByRole('button', { name: '설정' }));
  const drawer = await screen.findByRole('dialog', { name: '설정' });
  await user.click(within(drawer).getByRole('button', { name: '다시 시도' }));
  const recovered = await screen.findByRole('dialog', { name: 'Settings' });
  expect(within(recovered).getByRole('radio', { name: /Dark/ })).toBeChecked();
  await user.click(within(recovered).getByRole('button', { name: 'Close' }));
  expect(await screen.findByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'User research & competitive analysis', level: 2 })).toBeInTheDocument();
});
