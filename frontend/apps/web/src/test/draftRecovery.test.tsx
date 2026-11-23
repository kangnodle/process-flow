import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { createInitialState, createWorkflowReducer, STANDARD_PROCESS, taskForm } from '@process-flow/domain';
import { RequestError, type SavedWorkflow, type WorkflowRepository } from '@process-flow/application';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';

it('archives a conflicted draft separately and restores it only on explicit request', async () => {
  const user = userEvent.setup();
  const field = taskForm('goals')[0]!;
  let stored: SavedWorkflow = { id: 'one', version: 0, state: createInitialState(STANDARD_PROCESS, 'task') };
  let reject = true;
  const repository: WorkflowRepository = {
    open: async () => stored,
    execute: async (_id, version, command) => {
      if (reject) throw new RequestError('versionConflict', 'changed elsewhere');
      expect(version).toBe(stored.version);
      stored = {
        ...stored,
        version: version + 1,
        state: createWorkflowReducer(STANDARD_PROCESS)(stored.state, command),
      };
      return stored;
    },
  };
  render(
    <App
      platform={{ ...createFakePlatform(), workflowRepository: repository }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  await screen.findByText('저장 완료');
  const edit = screen.getByRole('textbox', { name: field.label.ko });
  fireEvent.change(edit, { target: { value: '내가 작성한 초안' } });
  await screen.findByRole('button', { name: '초안 보관하고 다시 불러오기' });
  stored = {
    ...stored,
    version: 2,
    state: {
      ...stored.state,
      records: {
        goals: {
          link: '',
          note: '',
          document: { version: 1, answers: { [field.id]: '서버 최신 내용' }, reviewStatus: 'pending' },
        },
      },
    },
  };
  reject = false;
  await user.click(screen.getByRole('button', { name: '초안 보관하고 다시 불러오기' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: field.label.ko })).toHaveValue('서버 최신 내용'));
  const archive = within(screen.getByRole('region', { name: '보관된 초안' }));
  await user.click(archive.getByText('목표와 문제 정의'));
  expect(archive.getByText('내가 작성한 초안')).toBeInTheDocument();
  await user.click(archive.getByRole('button', { name: '보관된 초안 적용' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: field.label.ko })).toHaveValue('내가 작성한 초안'));
  expect(screen.getByRole('combobox', { name: '검토 결과' })).toHaveValue('pending');
});
