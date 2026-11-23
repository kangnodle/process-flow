import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import type { WorkItem } from '@process-flow/domain';
import { createFakeAuth } from './fakeAuth';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';
import { openAdditionalRecords, fillTaskDocument } from './taskDocuments';

type Backend = ReturnType<typeof createFakeBackend>;

const here = { projectId: 'first', projectName: '첫 프로젝트', workflowId: 'wf-first', workflowName: '첫 워크플로' };
const planning = { stageId: 'planning', stageIndex: 0, rework: false };

const ITEMS: readonly WorkItem[] = [
  { ...here, ...planning, group: 'ready', kind: 'task', taskId: 'goals', taskNumber: 1, rework: true },
  {
    ...here,
    ...planning,
    group: 'waiting',
    kind: 'task',
    taskId: 'requirements',
    taskNumber: 4,
    wait: { kind: 'afterTasks', remaining: 3 },
  },
  { ...here, ...planning, group: 'waiting', kind: 'approval', wait: { kind: 'afterTasks', remaining: 7 } },
  {
    ...here,
    stageId: 'design',
    stageIndex: 1,
    rework: false,
    group: 'waiting',
    kind: 'task',
    taskId: 'wireframes',
    taskNumber: 8,
    wait: { kind: 'stageLocked' },
  },
  { ...here, ...planning, group: 'watching', kind: 'informed' },
];

const ME = { email: 'me@example.com', name: '김하나', password: 'correct-horse' };

const renderApp = (prepare: (backend: Backend) => void, options: { empty?: boolean } = {}) => {
  const user = userEvent.setup();
  const backend = createFakeBackend(options);
  prepare(backend);
  render(
    <App
      platform={{
        ...createFakePlatform(),
        workflowRepository: backend.workflowRepository,
        projectRepository: backend.projectRepository,
        userRepository: backend.userRepository,
        workRepository: backend.workRepository,
        authRepository: createFakeAuth({ accounts: [ME], signedIn: ME.email }).authRepository,
      }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  return { user, backend };
};

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: /^김하나 계정/ }));
  await user.click(await screen.findByRole('menuitem', { name: /^내 할 일/ }));
  return within(await screen.findByRole('main', { name: '내 할 일' }));
};

describe('내 할 일 페이지', () => {
  it('묶음별로 보여 주고, 기다리는 이유와 재작업을 알려 준다', async () => {
    const { user } = renderApp((backend) => backend.setWork(ITEMS));
    await screen.findByText('저장 완료');
    expect(screen.queryByRole('button', { name: /^내 할 일/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '김하나 계정, 지금 할 일 1개' })).toBeInTheDocument();

    const panel = await openPanel(user);
    const ready = within(await panel.findByRole('list', { name: '지금 할 일' }));
    expect(ready.getByText('작업 1 · 목표와 문제 정의')).toBeInTheDocument();
    expect(ready.getByText('재작업')).toBeInTheDocument();
    expect(ready.getByText('첫 프로젝트 · 첫 워크플로')).toBeInTheDocument();

    const waiting = within(panel.getByRole('list', { name: '대기 중' }));
    expect(waiting.getAllByRole('listitem')).toHaveLength(3);
    expect(waiting.getByText('앞 작업 3개가 끝나야 합니다.')).toBeInTheDocument();
    expect(waiting.getByText('1단계 기획·분석 승인')).toBeInTheDocument();
    expect(waiting.getByText('이 단계의 작업 7개가 끝나야 합니다.')).toBeInTheDocument();
    expect(waiting.getByText('2단계가 아직 잠겨 있습니다.')).toBeInTheDocument();

    expect(within(panel.getByRole('list', { name: '참고' })).getByText('1단계 기획·분석 · 통보')).toBeInTheDocument();
    expect(panel.queryByRole('list', { name: '누구나 할 수 있는 일' })).not.toBeInTheDocument();
  });

  it('페이지를 열면 제목으로, 뒤로 가면 워크플로 제목으로 포커스가 간다', async () => {
    const { user } = renderApp((backend) => backend.setWork(ITEMS));
    await screen.findByText('저장 완료');
    const page = await openPanel(user);
    await waitFor(() => expect(page.getByRole('heading', { level: 1, name: '내 할 일' })).toHaveFocus());
    await user.click(page.getByRole('button', { name: '뒤로' }));
    await waitFor(() => expect(screen.queryByRole('main', { name: '내 할 일' })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '첫 워크플로' })).toHaveFocus());
  });

  it('지금 연 워크플로의 항목을 누르면 워크플로 화면으로 돌아가 그 작업을 보여 준다', async () => {
    const { user } = renderApp((backend) => backend.setWork(ITEMS));
    await screen.findByText('저장 완료');
    const panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /^작업 4 · 요구사항 정의.* 열기$/ }));

    await waitFor(() => expect(screen.queryByRole('main', { name: '내 할 일' })).not.toBeInTheDocument());
    expect(screen.getByRole('tab', { name: '작업' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: '요구사항 정의' })).toBeInTheDocument();
  });

  it('다른 워크플로의 항목을 누르면 그 워크플로를 열어 그 작업을 보여 준다', async () => {
    let otherId = '';
    const { user, backend } = renderApp(() => undefined);
    await screen.findByText('저장 완료');
    const started = await backend.projectRepository.startWorkflow('first', '둘째 워크플로');
    otherId = started.id;
    backend.setWork([
      {
        projectId: 'first',
        projectName: '첫 프로젝트',
        workflowId: otherId,
        workflowName: '둘째 워크플로',
        ...planning,
        group: 'open',
        kind: 'task',
        taskId: 'goals',
        taskNumber: 1,
      },
      {
        projectId: 'first',
        projectName: '첫 프로젝트',
        workflowId: otherId,
        workflowName: '둘째 워크플로',
        ...planning,
        group: 'waiting',
        kind: 'approval',
        wait: { kind: 'afterTasks', remaining: 7 },
      },
    ]);

    const panel = await openPanel(user);
    const open = within(await panel.findByRole('list', { name: '누구나 할 수 있는 일' }));
    expect(panel.getByText('지금 할 일은 없습니다.')).toBeInTheDocument();
    await user.click(open.getByRole('button', { name: /둘째 워크플로 열기$/ }));

    expect(await screen.findByRole('heading', { level: 1, name: '둘째 워크플로' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: '목표와 문제 정의' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '작업' })).toHaveAttribute('aria-selected', 'true');
    expect(backend.currentWorkflowId()).toBe(otherId);
    expect(backend.savedPreferences()).toEqual([]);
  });

  it('작업을 완료하면 목록을 다시 불러온다', async () => {
    const { user, backend } = renderApp((backend) => backend.setWork(ITEMS));
    await screen.findByText('저장 완료');
    expect(await screen.findByRole('button', { name: '김하나 계정, 지금 할 일 1개' })).toBeInTheDocument();

    backend.setWork([
      { ...here, ...planning, group: 'ready', kind: 'task', taskId: 'user-research', taskNumber: 2 },
      { ...here, ...planning, group: 'ready', kind: 'approval' },
    ]);
    await user.click(screen.getByRole('tab', { name: '작업' }));
    await fillTaskDocument(user, 'goals');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    expect(await screen.findByRole('button', { name: '김하나 계정, 지금 할 일 2개' })).toBeInTheDocument();
  });

  it('작업 기록만 고쳐 저장하면 목록을 다시 불러오지 않는다', async () => {
    const { user, backend } = renderApp((backend) => backend.setWork(ITEMS));
    await screen.findByText('저장 완료');
    expect(await screen.findByRole('button', { name: '김하나 계정, 지금 할 일 1개' })).toBeInTheDocument();
    const mine = vi.spyOn(backend.workRepository, 'mine');

    await user.click(screen.getByRole('tab', { name: '작업' }));
    openAdditionalRecords();
    await user.type(screen.getByRole('textbox', { name: '메모' }), '검토 의견');
    expect(await screen.findByText('저장 중… 완료될 때까지 페이지를 닫지 마세요.')).toBeInTheDocument();
    expect(await screen.findByText('저장 완료')).toBeInTheDocument();
    expect(mine).not.toHaveBeenCalled();
  });
});

describe('첫 화면', () => {
  it('연 워크플로가 없으면 내 할 일을 보여 주고, 항목을 누르면 그 워크플로가 열린다', async () => {
    const { user, backend } = renderApp(() => undefined, { empty: true });
    expect(await screen.findByRole('heading', { level: 1, name: '열린 워크플로가 없습니다' })).toBeInTheDocument();
    expect(await screen.findByText('맡은 일이 없습니다.')).toBeInTheDocument();

    const project = await backend.projectRepository.create({ name: '결제 개편' });
    const workflow = await backend.projectRepository.startWorkflow(project.id, '웹 결제');
    backend.setWork([
      {
        projectId: project.id,
        projectName: '결제 개편',
        workflowId: workflow.id,
        workflowName: '웹 결제',
        ...planning,
        group: 'ready',
        kind: 'approval',
      },
    ]);
    const panel = await openPanel(user);
    await user.click(await panel.findByRole('button', { name: /^1단계 기획·분석 승인.* 열기$/ }));

    expect(await screen.findByRole('heading', { level: 1, name: '웹 결제' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '단계' })).toHaveAttribute('aria-selected', 'true');
  });

  it('불러오지 못하면 알리고 다시 시도할 수 있다', async () => {
    const { user, backend } = renderApp((backend) => backend.failWork(true), { empty: true });
    expect(await screen.findByText('할 일을 불러오지 못했습니다.')).toBeInTheDocument();
    backend.failWork(false);
    backend.setWork([]);
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByText('맡은 일이 없습니다.')).toBeInTheDocument();
  });

  it('할 일 저장소가 없으면 버튼도 목록도 없다', async () => {
    const backend = createFakeBackend();
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
    await screen.findByText('저장 완료');
    expect(screen.queryByRole('button', { name: /^내 할 일/ })).not.toBeInTheDocument();
  });
});
