import { fireEvent, screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { STANDARD_PROCESS, taskForm, type TaskRecord, type WorkflowState } from '@process-flow/domain';

export const completedDocument = (taskId: string): NonNullable<TaskRecord['document']> => ({
  version: 1,
  answers: Object.fromEntries(
    taskForm(taskId).map((field) => [
      field.id,
      `${field.label.ko}: 사용자 인터뷰와 팀 검토로 확인한 구체적인 결과를 기록합니다.`,
    ]),
  ),
  reviewStatus: 'passed',
});

export const withPlanningDocuments = (state: WorkflowState): WorkflowState => ({
  ...state,
  records: {
    ...state.records,
    ...Object.fromEntries(
      STANDARD_PROCESS.stages[0]!.tasks.map((task) => [
        task.id,
        { link: '', note: '', ...state.records[task.id], document: completedDocument(task.id) },
      ]),
    ),
  },
});

export const fillTaskDocument = async (user: ReturnType<typeof userEvent.setup>, taskId: string) => {
  const document = within(screen.getByRole('region', { name: '작업 문서' }));
  for (const field of taskForm(taskId)) {
    fireEvent.change(document.getByRole('textbox', { name: field.label.ko }), {
      target: { value: completedDocument(taskId).answers[field.id] },
    });
  }
  const review = document.getByRole('combobox', { name: '검토 결과' });
  if (review.tagName === 'SELECT') {
    await user.selectOptions(review, 'passed');
  } else {
    await user.click(review);
    await user.click(screen.getByRole('option', { name: '완료 기준 충족 · 차단 이슈 없음' }));
  }
};

export const openAdditionalRecords = () => {
  const summary = screen.getByText(/^(추가 기록|Additional notes)$/);
  if (!summary.closest('details')?.open) fireEvent.click(summary);
};
