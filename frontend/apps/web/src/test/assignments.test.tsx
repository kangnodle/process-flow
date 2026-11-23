import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import type { AssignmentsInput, Role } from '@process-flow/domain';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';
import { openAdditionalRecords, fillTaskDocument } from './taskDocuments';

type Backend = ReturnType<typeof createFakeBackend>;

const withTeam = async (backend: Backend) => {
  backend.setRole('owner');
  const names = ['김개발', '이디자인', '박보기'];
  for (const [index, name] of names.entries()) {
    const user = await backend.userRepository.create({
      email: `u${index + 1}@example.com`,
      name,
      password: 'password1',
    });
    await backend.userRepository.putMember('first', user.id, index === 2 ? 'viewer' : 'editor');
  }
};

const PLANNING: AssignmentsInput = {
  stages: [{ stageId: 'planning', accountable: 'u1', responsible: ['u2'], consulted: [], informed: [] }],
  tasks: [],
};

const renderApp = async ({
  role = 'owner',
  me = 'me',
  assigned,
}: { role?: Role; me?: string; assigned?: AssignmentsInput } = {}) => {
  const user = userEvent.setup();
  const backend = createFakeBackend({ me });
  await withTeam(backend);
  if (assigned) backend.assign('wf-first', assigned);
  backend.setRole(role);
  render(
    <App
      platform={{
        ...createFakePlatform(),
        workflowRepository: backend.workflowRepository,
        projectRepository: backend.projectRepository,
        userRepository: backend.userRepository,
      }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  await screen.findByText('저장 완료');
  return { user, backend };
};

const openAssignments = async (user: ReturnType<typeof userEvent.setup>) => {
  const assignments = screen.getByRole('button', { name: '담당' });
  expect(screen.getByRole('banner')).not.toContainElement(assignments);
  expect(screen.getByRole('banner')).not.toContainElement(screen.getByRole('progressbar', { name: '전체 진행률' }));
  await user.click(assignments);
  return within(await screen.findByRole('main', { name: '담당' }));
};

describe('담당 배정 페이지', () => {
  it('소유자가 단계의 승인자와 담당자, 작업의 담당자를 정해 저장한다', async () => {
    const { user, backend } = await renderApp();
    const panel = await openAssignments(user);
    const table = within(await panel.findByRole('table', { name: '기획·분석 단계 배정' }));
    expect(panel.getByRole('button', { name: '저장' })).toBeDisabled();
    expect(table.getByRole('radio', { name: '승인자 없음' })).toBeChecked();

    expect(table.getByRole('radio', { name: '박보기: 승인자' })).toBeDisabled();
    expect(table.getByRole('checkbox', { name: '박보기: 담당' })).toBeDisabled();
    expect(table.getByRole('checkbox', { name: '박보기: 협의' })).toBeEnabled();

    await user.click(table.getByRole('radio', { name: '김개발: 승인자' }));
    await user.click(table.getByRole('checkbox', { name: '이디자인: 담당' }));
    await user.click(table.getByRole('checkbox', { name: '박보기: 통보' }));
    await user.click(panel.getByRole('checkbox', { name: '목표와 문제 정의: 김개발 담당' }));
    await user.click(panel.getByRole('button', { name: '저장' }));

    expect(await panel.findByText('배정을 저장했습니다.')).toBeInTheDocument();
    expect(backend.assignmentsOf('wf-first')).toEqual({
      version: 1,
      stages: [{ stageId: 'planning', accountable: 'u1', responsible: ['u2'], consulted: [], informed: ['u3'] }],
      tasks: [{ taskId: 'goals', responsible: ['u1'] }],
    });
    expect(within(panel.getByRole('table')).getByRole('radio', { name: '김개발: 승인자' })).toBeChecked();
    expect(panel.getByRole('button', { name: '저장' })).toBeDisabled();

    const stages = within(panel.getByRole('tablist', { name: '단계' }));
    expect(stages.getAllByRole('tab')).toHaveLength(6);
    const planning = stages.getByRole('tab', { name: /^1\. 기획·분석/ });
    expect(planning).toHaveAttribute('aria-selected', 'true');
    expect(planning).toHaveTextContent('승인 김개발 · 담당 1명');
    const designTab = stages.getByRole('tab', { name: /^2\. 설계·디자인/ });
    expect(designTab).toHaveTextContent('승인자 없음');

    await user.click(designTab);
    expect(designTab).toHaveAttribute('aria-selected', 'true');
    expect(planning).toHaveAttribute('aria-selected', 'false');
    expect(panel.getByRole('tabpanel', { name: /^2\. 설계·디자인/ })).toBeInTheDocument();
    const design = within(panel.getByRole('table', { name: '설계·디자인 단계 배정' }));
    expect(design.getByRole('radio', { name: '승인자 없음' })).toBeChecked();
    await user.click(design.getByRole('radio', { name: '이디자인: 승인자' }));
    expect(designTab).toHaveTextContent('승인 이디자인');

    await user.click(panel.getByRole('button', { name: '뒤로' }));
    await user.click(screen.getByRole('tab', { name: '단계' }));
    expect(await screen.findByText('승인자: 김개발')).toBeInTheDocument();
    expect(screen.getByText('담당: 김개발')).toBeInTheDocument();
    expect(screen.getAllByText('담당: 이디자인').length).toBeGreaterThan(0);
  });

  it('소유자가 아니면 배정을 보기만 한다', async () => {
    const { user } = await renderApp({ role: 'editor', assigned: PLANNING });
    const panel = await openAssignments(user);
    const table = within(await panel.findByRole('table', { name: '기획·분석 단계 배정' }));
    expect(panel.getByText('배정은 소유자만 바꿀 수 있습니다.')).toBeInTheDocument();
    expect(table.getByRole('radio', { name: '김개발: 승인자' })).toBeChecked();
    expect(table.getByRole('radio', { name: '김개발: 승인자' })).toBeDisabled();
    expect(table.getByRole('checkbox', { name: '이디자인: 담당' })).toBeChecked();
    expect(table.getByRole('checkbox', { name: '이디자인: 담당' })).toBeDisabled();
    expect(panel.queryByRole('button', { name: '저장' })).not.toBeInTheDocument();
  });
});

describe('배정된 일', () => {
  it('담당이 아닌 편집자는 완료하거나 기록할 수 없고, 이유를 본다', async () => {
    const { user } = await renderApp({ role: 'editor', assigned: PLANNING });
    expect(screen.queryByText(/보기 전용 역할입니다/)).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '작업' }));
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeDisabled();
    const complete = screen.getByRole('button', { name: '완료하고 다음 작업으로' });
    expect(complete).toHaveAttribute('aria-disabled', 'true');
    expect(complete).toHaveAccessibleDescription('담당자(이디자인)만 할 수 있습니다.');
    expect(screen.getByText('담당: 이디자인 · 승인자: 김개발')).toBeInTheDocument();
  });

  it('담당자는 자기 작업을 완료하지만, 승인자가 아니면 단계를 승인할 수 없다', async () => {
    const { user } = await renderApp({ role: 'editor', me: 'u2', assigned: PLANNING });
    await user.click(screen.getByRole('tab', { name: '작업' }));
    for (const taskId of [
      'goals',
      'user-research',
      'user-modeling',
      'requirements',
      'information-architecture',
      'user-flows',
      'constraints',
    ]) {
      await fillTaskDocument(user, taskId);
      await user.click(screen.getByRole('button', { name: /완료하고 다음 작업으로|완료하고 단계 승인 요청/ }));
    }
    expect(await screen.findByText(/7\s*\/\s*25/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '단계' }));
    const approve = await screen.findByRole('button', { name: '승인하고 다음 단계 열기' });
    expect(approve).toHaveAttribute('aria-disabled', 'true');
  });

  it('소유자는 확인을 거쳐 대신 실행하고, 같은 작업은 다시 묻지 않는다', async () => {
    const { user } = await renderApp({ role: 'owner', assigned: PLANNING });
    await user.click(screen.getByRole('tab', { name: '작업' }));
    openAdditionalRecords();
    const note = screen.getByRole('textbox', { name: '메모' });
    await user.type(note, '검');
    const dialog = within(await screen.findByRole('dialog', { name: '대신 실행할까요?' }));
    expect(dialog.getByText(/이 일은 이디자인에게 배정되어 있습니다/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '대신 실행할까요?' })).not.toBeInTheDocument());
    expect(screen.getByText(/0\s*\/\s*25/)).toBeInTheDocument();
    await user.type(await screen.findByRole('textbox', { name: '메모' }), '검');
    await user.click(
      within(await screen.findByRole('dialog', { name: '대신 실행할까요?' })).getByRole('button', {
        name: '대신 실행',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '대신 실행할까요?' })).not.toBeInTheDocument());
    await screen.findByRole('region', { name: '작업 문서' });
    await fillTaskDocument(user, 'goals');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    expect(await screen.findByText(/1\s*\/\s*25/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 작업' }));
    await user.click(screen.getByRole('button', { name: '완료 취소' }));
    expect(await screen.findByText(/0\s*\/\s*25/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '대신 실행할까요?' })).not.toBeInTheDocument();
  });

  it('쓰는 도중 다른 사람에게 배정되면 변경을 버리고 알린다', async () => {
    const { user, backend } = await renderApp({ role: 'editor' });
    await user.click(screen.getByRole('tab', { name: '작업' }));
    await fillTaskDocument(user, 'goals');
    await screen.findByText('저장 완료');
    backend.assign('wf-first', PLANNING);
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    expect(await screen.findByText(/담당 배정이 바뀌어 방금 변경은 저장되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/0\s*\/\s*25/)).toBeInTheDocument();
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeDisabled();
  });
});
