import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';
import { openAdditionalRecords } from './taskDocuments';

const renderApp = (prepare?: (backend: ReturnType<typeof createFakeBackend>) => void) => {
  const user = userEvent.setup();
  const backend = createFakeBackend();
  prepare?.(backend);
  render(
    <App
      platform={{
        ...createFakePlatform(),
        workflowRepository: backend.workflowRepository,
        projectRepository: backend.projectRepository,
      }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  return { user, backend };
};

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: '프로젝트' }));
  return within(await screen.findByRole('main', { name: '프로젝트' }));
};

describe('프로젝트 페이지', () => {
  it('머리글에 지금 프로젝트와 워크플로 이름을 보여 준다', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: '첫 워크플로' })).toBeInTheDocument();
    expect(await screen.findByText('프로젝트 · 첫 프로젝트')).toBeInTheDocument();
  });

  it('프로젝트를 만들고 그 안에 워크플로를 시작하면 새 워크플로가 열린다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    let panel = await openPanel(user);
    const list = within(await panel.findByRole('list', { name: '프로젝트 목록' }));
    expect(list.getByRole('button', { name: /첫 프로젝트/ })).toHaveTextContent('현재');

    await user.click(panel.getByRole('button', { name: '새 프로젝트' }));
    await user.click(panel.getByRole('button', { name: '만들기' }));
    expect(panel.getByText('이름은 1~100자로 적어 주세요.')).toBeInTheDocument();
    await user.type(panel.getByRole('textbox', { name: '이름' }), '결제 개편');
    await user.type(panel.getByRole('textbox', { name: '설명' }), '2분기 목표');
    await user.click(panel.getByRole('button', { name: '만들기' }));

    expect(await panel.findByRole('heading', { name: '결제 개편' })).toBeInTheDocument();
    expect(panel.getByText('아직 워크플로가 없습니다.')).toBeInTheDocument();
    expect(panel.getByText(/한 프로젝트에서 여러 번 시작할 수 있습니다/)).toBeInTheDocument();
    expect(panel.getByRole('textbox', { name: '워크플로 이름' })).toHaveAttribute(
      'placeholder',
      '예: 결제 개편 1차 릴리스',
    );
    expect(panel.getByText(/비워 두면 "새 워크플로"가 됩니다/)).toBeInTheDocument();
    await user.type(panel.getByRole('textbox', { name: '워크플로 이름' }), '웹 결제');
    await user.click(panel.getByRole('button', { name: '시작' }));

    expect(await screen.findByRole('heading', { level: 1, name: '웹 결제' })).toBeInTheDocument();
    expect(await screen.findByText('프로젝트 · 결제 개편')).toBeInTheDocument();
    expect(backend.currentWorkflowId()).not.toBe('wf-first');

    panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    await user.click(await panel.findByRole('button', { name: '첫 워크플로 열기' }));
    expect(await screen.findByRole('heading', { level: 1, name: '첫 워크플로' })).toBeInTheDocument();
    expect(backend.currentWorkflowId()).toBe('wf-first');
  });

  it('이름을 바꾸면 머리글에 반영되고, 먼저 바뀐 경우 충돌을 알린다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    let panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    await panel.findByRole('heading', { name: '첫 프로젝트' });
    expect(panel.getByRole('button', { name: '보관' })).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: '편집' }));
    const name = panel.getByRole('textbox', { name: '이름' });
    await user.clear(name);
    await user.type(name, '공용');
    await user.click(panel.getByRole('button', { name: '저장' }));
    expect(await panel.findByRole('heading', { level: 1, name: '공용' })).toBeInTheDocument();
    expect(within(panel.getByRole('navigation', { name: '현재 위치' })).getByText('공용')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '홈' }));
    expect(await screen.findByText('프로젝트 · 공용')).toBeInTheDocument();

    backend.bump('first', '다른 사람이 바꾼 이름');
    panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /다른 사람이 바꾼 이름/ }));
    await panel.findByRole('heading', { level: 1, name: '다른 사람이 바꾼 이름' });
    backend.bump('first', '또 바뀐 이름');
    await user.click(panel.getByRole('button', { name: '편집' }));
    await user.type(panel.getByRole('textbox', { name: '이름' }), '!');
    await user.click(panel.getByRole('button', { name: '저장' }));
    expect(await panel.findByText(/다른 곳에서 먼저 바뀌었습니다/)).toBeInTheDocument();
  });

  it('보관한 프로젝트는 목록에서 빠지고 새 워크플로를 시작할 수 없다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    await backend.projectRepository.create({ name: '종료한 일' });
    const panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /종료한 일/ }));
    await user.click(await panel.findByRole('button', { name: '보관' }));
    expect(await panel.findByText(/보관한 프로젝트입니다/)).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '시작' })).not.toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: '뒤로' }));
    await waitFor(() => expect(panel.queryByRole('button', { name: /종료한 일/ })).not.toBeInTheDocument());
    await user.click(panel.getByRole('switch', { name: '보관한 프로젝트 표시' }));
    expect(await panel.findByRole('button', { name: /종료한 일/ })).toHaveTextContent('보관됨');
  });

  it('현재 보관 프로젝트를 확인 후 영구 삭제하고 워크플로 선택을 지운다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    const panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    expect(panel.queryByRole('button', { name: '영구 삭제' })).not.toBeInTheDocument();
    await user.click(await panel.findByRole('button', { name: '보관' }));
    const deleteButton = await panel.findByRole('button', { name: '영구 삭제' });
    await waitFor(() => expect(deleteButton).toBeEnabled());
    await user.click(deleteButton);
    const dialog = within(await screen.findByRole('dialog', { name: /영구 삭제/ }));
    expect(dialog.getByText(/복구할 수 없습니다/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await backend.projectRepository.get('first')).toBeDefined();
    await user.click(await panel.findByRole('button', { name: '영구 삭제' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '영구 삭제' }));
    await waitFor(() => expect(backend.currentWorkflowId()).toBeUndefined());
    expect(backend.workflowCount()).toBe(0);
    expect(await backend.projectRepository.list(true)).toHaveLength(0);
  });

  it('현재 프로젝트를 보관하면 세 탭에서 열람만 되고 보관 해제하면 다시 편집할 수 있다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    const panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    await user.click(await panel.findByRole('button', { name: '보관' }));
    const unarchive = await panel.findByRole('button', { name: '보관 해제' });
    await waitFor(() => expect(unarchive).toBeEnabled());
    await user.click(panel.getByRole('button', { name: '홈' }));

    const savedPreferences = backend.savedPreferences().length;
    for (const name of ['보드', '단계', '작업']) {
      const tab = await screen.findByRole('tab', { name });
      await user.click(tab);
      expect(tab).toHaveAttribute('aria-selected', 'true');
      expect(within(screen.getByRole('heading', { level: 1 })).getByText('보관됨')).toBeInTheDocument();
      expect(screen.getByText(/진행 상태와 기록을 열람할 수 있습니다/)).toBeInTheDocument();
    }
    expect(backend.savedPreferences()).toHaveLength(savedPreferences);
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '완료하고 다음 작업으로' })).toHaveAttribute('aria-disabled', 'true');

    await user.click(screen.getByRole('button', { name: '프로젝트' }));
    await user.click(await screen.findByRole('switch', { name: '보관한 프로젝트 표시' }));
    await user.click(await screen.findByRole('button', { name: /첫 프로젝트/ }));
    await user.click(await screen.findByRole('button', { name: '보관 해제' }));
    const archive = await screen.findByRole('button', { name: '보관' });
    await waitFor(() => expect(archive).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '홈' }));
    expect(await screen.findByRole('heading', { name: '첫 워크플로', level: 1 })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '작업' }));
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeEnabled();
  });

  it('기억하던 워크플로가 서버에 없으면 오류 대신 시작 안내를 보여 주고, 프로젝트 페이지에서 다른 워크플로를 열 수 있다', async () => {
    const { user, backend } = renderApp((b) => {
      void b.projectRepository.startWorkflow('first', '남은 워크플로');
      b.forgetCurrent();
    });
    expect(await screen.findByRole('heading', { level: 1, name: '열린 워크플로가 없습니다' })).toBeInTheDocument();
    expect(screen.queryByText(/이 워크플로는 더 이상 없습니다/)).not.toBeInTheDocument();
    expect(backend.currentWorkflowId()).toBeUndefined();
    expect(backend.workflowCount()).toBe(1);

    await user.click(screen.getByRole('button', { name: '프로젝트 페이지 열기' }));
    const panel = within(await screen.findByRole('main', { name: '프로젝트' }));
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    expect(panel.queryByText(/저장을 확인하지 못한 변경이 있어/)).not.toBeInTheDocument();
    const open = await panel.findByRole('button', { name: '남은 워크플로 열기' });
    expect(open).toBeEnabled();
    await user.click(open);
    expect(await screen.findByRole('heading', { level: 1, name: '남은 워크플로' })).toBeInTheDocument();
    expect(await screen.findByText('저장 완료')).toBeInTheDocument();
  });

  it('처음에는 프로젝트도 워크플로도 없고, 프로젝트를 만들어 그 안에 워크플로를 시작해야 열린다', async () => {
    const user = userEvent.setup();
    const backend = createFakeBackend({ empty: true });
    render(
      <App
        platform={{
          ...createFakePlatform(),
          workflowRepository: backend.workflowRepository,
          projectRepository: backend.projectRepository,
        }}
        initialPreferences={{ locale: 'ko', theme: 'light' }}
      />,
    );
    expect(await screen.findByRole('heading', { level: 1, name: '열린 워크플로가 없습니다' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(backend.workflowCount()).toBe(0);
    expect(
      screen.getByText(/워크플로는 공정 6단계\(작업 25개\)를 처음부터 끝까지 한 번 진행하는 단위입니다/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '프로젝트 페이지 열기' }));
    const panel = within(await screen.findByRole('main', { name: '프로젝트' }));
    const showArchived = panel.getByRole('switch', { name: '보관한 프로젝트 표시' });
    expect(showArchived).not.toBeChecked();
    expect(await panel.findByText('활성 프로젝트가 없습니다')).toBeInTheDocument();
    await user.click(showArchived);
    expect(await panel.findByText('프로젝트가 없습니다.')).toBeInTheDocument();
    expect(panel.getByText(/프로젝트는 워크플로 여러 개를 묶는 단위입니다/)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '새 프로젝트' }));
    await user.type(panel.getByRole('textbox', { name: '이름' }), '결제 개편');
    await user.click(panel.getByRole('button', { name: '만들기' }));
    expect(await panel.findByText('아직 워크플로가 없습니다.')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '시작' }));

    expect(await screen.findByRole('heading', { level: 1, name: '새 워크플로' })).toBeInTheDocument();
    expect(await screen.findByText('프로젝트 · 결제 개편')).toBeInTheDocument();
    expect(await screen.findByText('저장 완료')).toBeInTheDocument();
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(backend.workflowCount()).toBe(1);
  });

  it('프로젝트 저장소가 없으면(시연 모드) 프로젝트 버튼이 없다', () => {
    render(<App platform={createFakePlatform()} initialPreferences={{ locale: 'ko', theme: 'light' }} />);
    expect(screen.queryByRole('button', { name: '프로젝트' })).not.toBeInTheDocument();
  });
});
