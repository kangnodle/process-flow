import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { STANDARD_PROCESS, createInitialState, taskForm } from '@process-flow/domain';
import { RequestError } from '@process-flow/application';
import { createFakeBackend } from './fakeProjects';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';
import { fillTaskDocument } from './taskDocuments';

const renderDocument = () => {
  const user = userEvent.setup();
  render(
    <App
      platform={createFakePlatform()}
      initialState={createInitialState(STANDARD_PROCESS, 'task')}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  return user;
};

const complete = () => screen.getByRole('button', { name: '완료하고 다음 작업으로' });

describe('작업 문서', () => {
  it('빈 문서와 증빙만 있는 문서는 작업을 완료할 수 없다', async () => {
    const user = renderDocument();
    expect(complete()).toHaveAttribute('aria-disabled', 'true');
    const document = within(screen.getByRole('region', { name: '작업 문서' }));
    for (const field of taskForm('goals')) {
      expect(document.getByRole('textbox', { name: field.label.ko })).toBeRequired();
    }
    fireEvent.change(document.getByRole('textbox', { name: '증빙 제목' }), { target: { value: '목표 검토 자료' } });
    fireEvent.change(document.getByRole('textbox', { name: '증빙 설명' }), { target: { value: '사용자 인터뷰 원본' } });
    fireEvent.change(document.getByRole('textbox', { name: '외부 문서 링크' }), {
      target: { value: 'https://example.com/research' },
    });
    await user.click(document.getByRole('button', { name: '링크 추가' }));
    expect(document.getByRole('link', { name: 'https://example.com/research' })).toHaveAttribute(
      'href',
      'https://example.com/research',
    );
    await user.selectOptions(document.getByRole('combobox', { name: '검토 결과' }), 'passed');
    expect(complete()).toHaveAttribute('aria-disabled', 'true');
    await user.click(complete());
    expect(screen.getByText('전체 진행 0 / 25')).toBeInTheDocument();
  });

  it('필수 내용과 통과 검토가 있어야 완료되고 완료한 문서는 다시 열기 전까지 편집할 수 없다', async () => {
    const user = renderDocument();
    await fillTaskDocument(user, 'goals');
    const document = within(screen.getByRole('region', { name: '작업 문서' }));
    await user.selectOptions(document.getByRole('combobox', { name: '검토 결과' }), 'blocked');
    expect(complete()).toHaveAttribute('aria-disabled', 'true');
    await user.selectOptions(document.getByRole('combobox', { name: '검토 결과' }), 'passed');
    expect(complete()).not.toHaveAttribute('aria-disabled', 'true');
    await user.click(complete());
    expect(screen.getByText('전체 진행 1 / 25')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 작업' }));
    const completed = within(screen.getByRole('region', { name: '작업 문서' }));
    for (const field of taskForm('goals')) {
      expect(completed.getByRole('textbox', { name: field.label.ko })).toBeDisabled();
    }
    expect(completed.getByRole('combobox', { name: '검토 결과' })).toBeDisabled();
    expect(completed.queryByRole('button', { name: '링크 추가' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '완료 취소' }));
    expect(completed.getByRole('textbox', { name: taskForm('goals')[0]!.label.ko })).toBeEnabled();
  });

  it('내용을 고치면 검토를 다시 해야 하고 작성 결과는 작업을 오가도 유지된다', async () => {
    const user = renderDocument();
    await fillTaskDocument(user, 'goals');
    const field = taskForm('goals')[0]!;
    fireEvent.change(screen.getByRole('textbox', { name: field.label.ko }), {
      target: { value: '고객이 겪는 주요 문제를 추가 인터뷰로 수정했습니다.' },
    });
    expect(screen.getByRole('combobox', { name: '검토 결과' })).toHaveValue('pending');
    expect(complete()).toHaveAttribute('aria-disabled', 'true');
    const nav = within(screen.getByRole('navigation', { name: '공정 작업 목록' }));
    await user.click(nav.getByRole('button', { name: /2\. 사용자 리서치/ }));
    await user.click(nav.getByRole('button', { name: /1\. 목표와 문제 정의/ }));
    expect(screen.getByRole('textbox', { name: field.label.ko })).toHaveValue(
      '고객이 겪는 주요 문제를 추가 인터뷰로 수정했습니다.',
    );
    expect(screen.getByRole('combobox', { name: '검토 결과' })).toHaveValue('pending');
  });
  it('첨부파일을 읽는 동안 완료를 막고, 저장된 파일을 다운로드하며 다음 작업에서도 읽는다', async () => {
    const user = userEvent.setup();
    let finishRead!: (value: { fileName: string; mediaType: string; size: number; base64: string }) => void;
    const read = vi.fn(
      () =>
        new Promise<{ fileName: string; mediaType: string; size: number; base64: string }>((resolve) => {
          finishRead = resolve;
        }),
    );
    const download = vi.fn();
    const fileValue = { fileName: '인터뷰.txt', mediaType: 'text/plain', size: 3, base64: 'YWJj' };
    render(
      <App
        platform={{ ...createFakePlatform(), evidenceFiles: { read, download, createId: () => 'file-evidence-1' } }}
        initialState={createInitialState(STANDARD_PROCESS, 'task')}
        initialPreferences={{ locale: 'ko', theme: 'light' }}
      />,
    );
    await fillTaskDocument(user, 'goals');
    const file = new File(['abc'], fileValue.fileName, { type: fileValue.mediaType });
    await user.upload(screen.getByLabelText('첨부파일 추가'), file);
    expect(read).toHaveBeenCalledWith(file);
    expect(complete()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('파일 읽는 중…')).toBeInTheDocument();
    for (const field of taskForm('goals')) expect(screen.getByRole('textbox', { name: field.label.ko })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '검토 결과' })).toBeDisabled();
    await act(async () => {
      finishRead(fileValue);
    });
    const document = within(screen.getByRole('region', { name: '작업 문서' }));
    expect(document.getByRole('textbox', { name: '증빙 제목 1' })).toHaveValue(fileValue.fileName);
    for (const field of taskForm('goals'))
      expect(document.getByRole('textbox', { name: field.label.ko })).toBeEnabled();
    expect(document.getByRole('combobox', { name: '검토 결과' })).toHaveValue('pending');
    await user.click(document.getByRole('button', { name: '인터뷰.txt · 다운로드' }));
    expect(download).toHaveBeenCalledWith({
      fileName: fileValue.fileName,
      mediaType: fileValue.mediaType,
      base64: fileValue.base64,
    });
    await user.selectOptions(document.getByRole('combobox', { name: '검토 결과' }), 'passed');
    await user.click(complete());
    expect(screen.getByText('전체 진행 1 / 25')).toBeInTheDocument();
    await user.click(screen.getByText(/^이전 작업의 작성 결과/));
    expect(screen.getByRole('button', { name: '인터뷰.txt · 다운로드' })).toBeEnabled();
  });
  it.each(['unknown', 'versionConflict'] as const)(
    '저장 실패(%s) 시 작성한 문서를 보존하고 완료 명령을 보내지 않는다',
    async (kind) => {
      const user = userEvent.setup();
      const backend = createFakeBackend();
      const execute = vi
        .spyOn(backend.workflowRepository, 'execute')
        .mockRejectedValue(new RequestError(kind, 'save failed'));
      render(
        <App
          platform={{ ...createFakePlatform(), workflowRepository: backend.workflowRepository }}
          initialPreferences={{ locale: 'ko', theme: 'light' }}
        />,
      );
      await screen.findByText('저장 완료');
      await user.click(screen.getByRole('tab', { name: '작업' }));
      await fillTaskDocument(user, 'goals');
      const firstField = taskForm('goals')[0]!;
      const original = screen.getByRole('textbox', { name: firstField.label.ko }) as HTMLTextAreaElement;
      const draft = original.value;
      await user.click(complete());
      await waitFor(() => expect(complete()).toHaveAttribute('aria-disabled', 'true'));
      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls.every(([, , command]) => command.type === 'updateRecord')).toBe(true);
      expect(screen.getByRole('textbox', { name: firstField.label.ko })).toHaveValue(draft);
      expect(screen.getByRole('combobox', { name: '검토 결과' })).toHaveValue('passed');
      expect(screen.getByText('전체 진행 0 / 25')).toBeInTheDocument();
    },
  );
});
