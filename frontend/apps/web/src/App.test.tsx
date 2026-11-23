import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  STANDARD_PROCESS as P,
  STANDARD_PROCESS_TEXT,
  createDemoState,
  createInitialState,
  getStage,
  taskText,
  type WorkflowState,
} from '@process-flow/domain';
import { App } from './App';
import { createFakePlatform } from './test/fakePlatform';
import { openAdditionalRecords, fillTaskDocument, withPlanningDocuments } from './test/taskDocuments';
import type { Platform, WorkflowRepository } from '@process-flow/application';

const renderApp = (initialState: WorkflowState = createInitialState(P), overrides?: Partial<Platform>) => {
  const user = userEvent.setup();
  const platform = { ...createFakePlatform(), ...overrides };
  render(<App platform={platform} initialState={initialState} initialPreferences={{ locale: 'ko', theme: 'light' }} />);
  return { user, platform };
};

describe('App', () => {
  it('세 가지 뷰 탭을 보여 주고 보드 뷰로 시작한다', () => {
    render(<App platform={createFakePlatform()} initialPreferences={{ locale: 'ko', theme: 'light' }} />);
    const tablist = within(screen.getByRole('tablist', { name: '보기 방식' }));
    expect(tablist.getAllByRole('tab')).toHaveLength(3);
    for (const name of ['단계', '작업', '보드']) {
      expect(tablist.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(tablist.getByRole('tab', { name: '보드' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: '전체 공정 보드', level: 2 })).toBeInTheDocument();
  });

  it('선택한 보기 탭과 패널을 연결한다', async () => {
    const { user } = renderApp();
    const tab = screen.getByRole('tab', { name: '작업' });
    await user.click(tab);
    const panel = screen.getByRole('tabpanel', { name: '작업' });
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(within(panel).queryByRole('main')).not.toBeInTheDocument();
  });

  it('좁은 화면에서는 작업 목록을 열고 작업을 고르면 목록을 닫는다', async () => {
    const { user } = renderApp(createInitialState(P, 'task'), {
      compactTaskLayout: { current: () => true, subscribe: () => () => undefined },
    });
    const open = screen.getByRole('button', { name: '공정 작업 목록' });
    expect(screen.queryByRole('navigation', { name: '공정 작업 목록' })).not.toBeInTheDocument();
    await user.click(open);
    const drawer = await screen.findByRole('dialog', { name: '공정 작업 목록' });
    await user.click(within(drawer).getByRole('button', { name: /2\. 사용자 리서치/ }));
    expect(await screen.findByRole('heading', { name: '사용자 리서치·경쟁 분석', level: 2 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '공정 작업 목록' })).not.toBeInTheDocument();
    await user.click(open);
    await screen.findByRole('dialog', { name: '공정 작업 목록' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '공정 작업 목록' })).not.toBeInTheDocument());
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('단계와 보드는 문서를 열고 직접 완료하는 체크박스는 없다', async () => {
    const { user } = renderApp(createInitialState(P, 'stage'));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /목표와 문제 정의.*열기/ }));
    expect(screen.getByRole('region', { name: '작업 문서' })).toBeInTheDocument();
    await fillTaskDocument(user, 'goals');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    expect(screen.getByText('전체 진행 1 / 25')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '보드' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /목표와 문제 정의/ })).toHaveTextContent('완료');
  });

  it('앞 단계의 문서를 모두 완료하고 승인하기 전에는 다음 단계를 열 수 없다', async () => {
    const { user } = renderApp(createInitialState(P, 'stage'));
    const openButton = screen.getByRole('button', { name: '승인하고 다음 단계 열기' });
    expect(openButton).toHaveAttribute('aria-disabled', 'true');
    expect(openButton).toHaveAccessibleDescription(/남은 작업 \d+개를 순서대로 완료하면 단계를 승인할 수 있습니다/);
    await user.click(openButton);
    expect(screen.getByRole('heading', { name: '기획·분석', level: 2 })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '작업' }));
    for (const task of getStage(P, 0).tasks) {
      await fillTaskDocument(user, task.id);
      await user.click(screen.getByRole('button', { name: /완료하고 다음 작업으로|완료하고 단계 승인 요청/ }));
    }
    await user.click(screen.getByRole('tab', { name: '단계' }));
    const approve = screen.getByRole('button', { name: '승인하고 다음 단계 열기' });
    expect(approve).not.toHaveAttribute('aria-disabled', 'true');
    expect(approve).toHaveAccessibleDescription('');
    await user.click(approve);
    expect(screen.getByRole('heading', { name: '설계·디자인', level: 2 })).toBeInTheDocument();
  });

  it('작업 완료 버튼의 비활성 이유가 사라져도 포커스를 유지하고 경고를 내지 않는다', () => {
    const errors = vi.spyOn(console, 'error');
    try {
      renderApp(createInitialState(P, 'task'));
      const button = screen.getByRole('button', { name: '완료하고 다음 작업으로' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      act(() => button.focus());

      const document = within(screen.getByRole('region', { name: '작업 문서' }));
      for (const input of document.getAllByRole('textbox', { hidden: false })) {
        fireEvent.change(input, { target: { value: '사용자 인터뷰와 팀 검토로 확인한 구체적인 결과입니다.' } });
      }
      fireEvent.change(document.getByRole('combobox', { name: '검토 결과' }), { target: { value: 'passed' } });

      expect(button).not.toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveFocus();
      expect(button).toHaveAccessibleDescription('');
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      expect(errors.mock.calls.flat()).not.toContainEqual(expect.stringContaining('[useControllableState]'));
    } finally {
      errors.mockRestore();
    }
  });

  it('작업은 순서대로만 완료하고, 완료 취소는 마지막으로 완료한 작업만 된다', async () => {
    const { user } = renderApp(createInitialState(P, 'task'));
    await fillTaskDocument(user, 'goals');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    await fillTaskDocument(user, 'user-research');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    const nav = within(screen.getByRole('navigation', { name: '공정 작업 목록' }));
    await user.click(nav.getByRole('button', { name: /1\. 목표와 문제 정의/ }));
    expect(screen.queryByRole('button', { name: '완료 취소' })).not.toBeInTheDocument();
    await user.click(nav.getByRole('button', { name: /2\. 사용자 리서치/ }));
    await user.click(screen.getByRole('button', { name: '완료 취소' }));
    expect(screen.getByText('전체 진행 1 / 25')).toBeInTheDocument();
    await user.click(nav.getByRole('button', { name: /1\. 목표와 문제 정의/ }));
    expect(screen.getByRole('button', { name: '완료 취소' })).toBeEnabled();
  });

  it('보드에서 차례가 아닌 작업을 열면 이유를 알려 주고 완료할 수 없다', async () => {
    const { user } = renderApp(createInitialState(P, 'board'));
    const third = taskText(STANDARD_PROCESS_TEXT.ko, getStage(P, 0).tasks[2]!).name;
    await user.click(screen.getByRole('button', { name: new RegExp(third) }));
    const button = await screen.findByRole('button', { name: '완료하고 다음 작업으로' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/먼저 작업 1 · 목표와 문제 정의을\(를\) 완료하세요/);
  });

  it('완료한 작업에서 사유를 적고 재작업을 요청하면, 그 뒤 작업까지 재작업 대상이 되고 승인이 취소된다', async () => {
    const { user } = renderApp(withPlanningDocuments(createDemoState(P, 'task')));
    const nav = within(screen.getByRole('navigation', { name: '공정 작업 목록' }));
    await user.click(nav.getByRole('button', { name: /1\. 기획·분석/ }));
    const sixth = taskText(STANDARD_PROCESS_TEXT.ko, getStage(P, 0).tasks[5]!).name;
    await user.click(nav.getByRole('button', { name: new RegExp(`6\\. ${sixth}`) }));

    await user.click(screen.getByRole('button', { name: '재작업 요청' }));
    const dialog = within(await screen.findByRole('dialog', { name: '재작업 요청' }));
    expect(dialog.getByText(/작업 6부터 작업 8까지 3개가 재작업 대상이 됩니다/)).toBeInTheDocument();
    expect(dialog.getByText(/1단계 승인도 취소되어/)).toBeInTheDocument();
    const confirm = dialog.getByRole('button', { name: '재작업 시작' });
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByRole('textbox', { name: /재작업 사유/ }), '사용자 흐름 누락');
    await user.click(confirm);

    expect(screen.getByText('재작업 진행 중')).toBeInTheDocument();
    expect(screen.getByText('작업 6~8 · 사유: 사용자 흐름 누락')).toBeInTheDocument();
    expect(screen.getByText('재작업 중')).toBeInTheDocument();
    expect(screen.getByText('전체 진행 5 / 25')).toBeInTheDocument();
    expect(await nav.findByRole('button', { name: /8\. 와이어프레임/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('잠긴 단계는 스테퍼에서 포커스를 받고 이유를 알려 주지만 이동하지 않는다', async () => {
    const { user } = renderApp(createInitialState(P, 'stage'));
    const stepper = within(screen.getByRole('navigation', { name: '개발 공정 단계' }));
    const lockedStep = stepper.getByRole('button', { name: /2\. 설계·디자인/ });
    expect(lockedStep).toHaveAttribute('aria-disabled', 'true');
    expect(lockedStep).toHaveAccessibleDescription('1단계가 승인되면 열립니다.');
    lockedStep.focus();
    expect(lockedStep).toHaveFocus();
    await user.click(lockedStep);
    expect(screen.getByRole('heading', { name: '기획·분석', level: 2 })).toBeInTheDocument();
  });

  it('보드에서 고른 작업이 작업 뷰에서 그대로 열린다', async () => {
    const { user } = renderApp(createDemoState(P, 'board'));
    await user.click(screen.getByRole('button', { name: /UI 비주얼 디자인/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'UI 비주얼 디자인', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '작업' })).toHaveAttribute('aria-selected', 'true');
  });

  it('작업 뷰의 기록 입력은 작업별로 유지된다', async () => {
    const { user } = renderApp(withPlanningDocuments(createDemoState(P, 'task')));
    openAdditionalRecords();
    await user.type(screen.getByRole('textbox', { name: '메모' }), '레이아웃 1차 확정');
    await fillTaskDocument(user, 'wireframes');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: '이전 작업' }));
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toHaveValue('레이아웃 1차 확정');
  });

  it('작업 뷰의 측면 탐색(Nav)에서 작업을 고르고, 잠긴 작업은 이유만 알려 준다', async () => {
    const { user } = renderApp(withPlanningDocuments(createDemoState(P, 'task')));
    const nav = within(screen.getByRole('navigation', { name: '공정 작업 목록' }));
    expect(nav.getByRole('button', { name: /8\. 와이어프레임/ })).toHaveAttribute('aria-current', 'page');

    await user.click(nav.getByRole('button', { name: /9\. 프로토타입·사용성 테스트/ }));
    expect(screen.getByRole('heading', { name: '프로토타입·사용성 테스트', level: 2 })).toBeInTheDocument();
    expect(nav.getByRole('button', { name: /9\. 프로토타입·사용성 테스트/ })).toHaveAttribute('aria-current', 'page');

    const lockedStage = nav.getByRole('button', { name: /3\. 개발/ });
    expect(lockedStage).toHaveAttribute('aria-expanded', 'false');
    await user.click(lockedStage);
    expect(lockedStage).toHaveAttribute('aria-expanded', 'true');

    const lockedTask = nav.getByRole('button', { name: /14\. 개발 환경 구축/ });
    expect(lockedTask).toHaveAttribute('aria-disabled', 'true');
    expect(lockedTask).toHaveAccessibleDescription('2단계가 승인되면 열립니다.');
    await user.click(lockedTask);
    expect(screen.getByRole('heading', { name: '프로토타입·사용성 테스트', level: 2 })).toBeInTheDocument();
  });

  it('설정 패널에서 언어를 바꾸면 화면 전체와 문서 언어가 바뀌고, 다음 방문을 위해 저장된다', async () => {
    const { user, platform } = renderApp(createInitialState(P, 'stage'));
    expect(platform.language()).toBe('ko');
    expect(platform.title()).toBe('개발 공정 관리 · Process Flow');
    await user.click(screen.getByRole('button', { name: '설정' }));
    const panel = within(await screen.findByRole('dialog', { name: '설정' }));
    await user.click(panel.getByRole('radio', { name: /English/ }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument());

    const tablist = within(await screen.findByRole('tablist', { name: 'View' }));
    for (const name of ['Stages', 'Tasks', 'Board']) {
      expect(tablist.getByRole('tab', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Planning & analysis', level: 2 })).toBeInTheDocument();
    expect(platform.language()).toBe('en');
    expect(platform.title()).toBe('Development process · Process Flow');
  });

  it('설정 패널에서 테마를 고르면 저장되고, 시스템 설정 항목은 운영체제의 현재 모드를 알려 준다', async () => {
    const { user, platform } = renderApp();
    await user.click(screen.getByRole('button', { name: '설정' }));
    const panel = within(await screen.findByRole('dialog', { name: '설정' }));
    expect(panel.getByRole('radio', { name: '라이트' })).toBeChecked();
    expect(panel.getByText('지금은 라이트')).toBeInTheDocument();

    await user.click(panel.getByRole('radio', { name: '다크' }));
    expect(panel.getByRole('radio', { name: '다크' })).toBeChecked();

    act(() => platform.setSystemMode('dark'));
    expect(panel.getByText('지금은 다크')).toBeInTheDocument();
  });

  it('서버에 저장된 설정이 없으면 선호 언어로 시작한다', () => {
    render(<App platform={createFakePlatform({ preferredLanguages: ['en-US', 'ko'] })} />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeInTheDocument();
  });

  it('설정 패널을 닫으면 키보드 포커스가 설정 버튼으로 돌아간다', async () => {
    const { user } = renderApp();
    const settingsButton = screen.getByRole('button', { name: '설정' });
    await user.click(settingsButton);
    await screen.findByRole('dialog', { name: '설정' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '설정' })).not.toBeInTheDocument());
    await waitFor(() => expect(settingsButton).toHaveFocus());
  });

  it('서버에 저장한 뷰가 없으면 워크플로를 불러오기 전후에 보드 탭을 선택한다', async () => {
    const repository: WorkflowRepository = {
      open: async () => ({ id: 'ws', version: 0, state: createInitialState(P) }),
      execute: vi.fn(),
    };
    render(
      <App
        platform={{ ...createFakePlatform(), workflowRepository: repository }}
        initialPreferences={{ locale: 'ko', theme: 'light' }}
      />,
    );

    expect(screen.getByText('저장된 작업을 불러오는 중…')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '보드', selected: true })).toBeInTheDocument();
    await screen.findByText('저장 완료');
    expect(screen.getByRole('tab', { name: '보드', selected: true })).toBeInTheDocument();
  });

  it('워크스페이스에 저장된 언어·테마·뷰로 복원하고, 바꾼 항목만 서버에 저장한다', async () => {
    const user = userEvent.setup();
    const platform = createFakePlatform();
    const savePreferences = vi.fn<NonNullable<WorkflowRepository['savePreferences']>>().mockResolvedValue({});
    const repository: WorkflowRepository = {
      open: async () => ({
        id: 'ws',
        version: 0,
        state: createInitialState(P),
        preferences: { locale: 'en', theme: 'dark', view: 'stage', selectedTaskId: 'goals' },
      }),
      execute: vi.fn(),
      savePreferences,
    };
    render(<App platform={{ ...platform, workflowRepository: repository }} />);

    const tablist = within(await screen.findByRole('tablist', { name: 'View' }));
    expect(tablist.getByRole('tab', { name: 'Stages' })).toHaveAttribute('aria-selected', 'true');
    expect(platform.language()).toBe('en');
    expect(savePreferences).not.toHaveBeenCalled();

    await user.click(tablist.getByRole('tab', { name: 'Board' }));
    expect(savePreferences).toHaveBeenLastCalledWith('ws', { view: 'board' });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const panel = within(await screen.findByRole('dialog', { name: 'Settings' }));
    await user.click(panel.getByRole('radio', { name: /한국어/ }));
    await vi.waitFor(() => expect(savePreferences).toHaveBeenLastCalledWith('ws', { locale: 'ko' }));
    expect(panel.getByRole('radio', { name: '다크' })).toBeChecked();
  });
});
