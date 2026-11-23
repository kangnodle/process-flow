import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { createInitialState, STANDARD_PROCESS, taskForm } from '@process-flow/domain';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';

it('leaving a pending file read releases the task and discards its late result', async () => {
  const user = userEvent.setup();
  let finish!: (value: { fileName: string; mediaType: string; size: number; base64: string }) => void;
  const read = () =>
    new Promise<{ fileName: string; mediaType: string; size: number; base64: string }>((resolve) => {
      finish = resolve;
    });
  render(
    <App
      platform={{ ...createFakePlatform(), evidenceFiles: { read, download: vi.fn(), createId: () => 'file-1' } }}
      initialState={createInitialState(STANDARD_PROCESS, 'task')}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  await user.upload(screen.getByLabelText('첨부파일 추가'), new File(['abc'], 'late.txt', { type: 'text/plain' }));
  const nav = within(screen.getByRole('navigation', { name: '공정 작업 목록' }));
  await user.click(nav.getByRole('button', { name: /2\. 사용자 리서치/ }));
  await user.click(nav.getByRole('button', { name: /1\. 목표와 문제 정의/ }));
  expect(screen.getByRole('textbox', { name: taskForm('goals')[0]!.label.ko })).toBeEnabled();
  await act(async () => {
    finish({ fileName: 'late.txt', mediaType: 'text/plain', size: 3, base64: 'YWJj' });
  });
  expect(screen.queryByRole('button', { name: 'late.txt · 다운로드' })).not.toBeInTheDocument();
});
