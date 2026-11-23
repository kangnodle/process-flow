import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import type { Navigation } from '@process-flow/application';
import { createMemoryNavigation } from '@process-flow/runtime';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';

const renderApp = (navigation?: Navigation) => {
  const user = userEvent.setup();
  const backend = createFakeBackend();
  render(
    <App
      platform={{
        ...createFakePlatform(),
        ...(navigation ? { navigation } : {}),
        workflowRepository: backend.workflowRepository,
        projectRepository: backend.projectRepository,
        userRepository: backend.userRepository,
      }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  return { user, backend };
};

const menu = (name: string) => within(screen.getByRole('banner')).getByRole('button', { name });
const trail = (page: ReturnType<typeof within>) =>
  within(page.getByRole('navigation', { name: '현재 위치' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

const expectFocusInside = async (name: string) => {
  const page = await screen.findByRole('main', { name });
  await waitFor(() => expect(page).toContainElement(document.activeElement as HTMLElement));
};

describe('페이지와 빵 부스러기', () => {
  it('머리글 메뉴는 페이지로 가고, 지금 페이지를 표시하며, 빵 부스러기로 홈에 돌아온다', async () => {
    const { user } = renderApp();
    await screen.findByText('저장 완료');
    await user.click(menu('프로젝트'));
    const page = within(await screen.findByRole('main', { name: '프로젝트' }));
    expect(menu('프로젝트')).toHaveAttribute('aria-current', 'page');
    expect(menu('사용자')).not.toHaveAttribute('aria-current');
    expect(trail(page)).toEqual(['홈', '프로젝트']);
    await waitFor(() => expect(page.getByRole('heading', { level: 1, name: '프로젝트' })).toHaveFocus());

    await user.click(await page.findByRole('button', { name: /첫 프로젝트/ }));
    await waitFor(() => expect(page.getByRole('heading', { level: 1, name: '첫 프로젝트' })).toHaveFocus());
    expect(trail(page)).toEqual(['홈', '프로젝트', '첫 프로젝트']);
    expect(menu('프로젝트')).toHaveAttribute('aria-current', 'page');

    await user.click(page.getByRole('button', { name: '프로젝트' }));
    await page.findByRole('list', { name: '프로젝트 목록' });
    await user.click(page.getByRole('button', { name: '홈' }));
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '첫 워크플로' })).toHaveFocus());
  });

  it('뒤로 가기는 앞서 본 페이지로 돌아간다', async () => {
    const navigation = createMemoryNavigation();
    const { user } = renderApp(navigation);
    await screen.findByText('저장 완료');
    await user.click(menu('사용자'));
    await user.click(menu('프로젝트'));
    const page = within(await screen.findByRole('main', { name: '프로젝트' }));
    await user.click(await page.findByRole('button', { name: /첫 프로젝트/ }));
    expect(navigation.current()).toBe('/projects/first');

    await user.click(page.getByRole('button', { name: '뒤로' }));
    await page.findByRole('list', { name: '프로젝트 목록' });
    await user.click(page.getByRole('button', { name: '뒤로' }));
    const users = within(await screen.findByRole('main', { name: '사용자' }));
    await user.click(users.getByRole('button', { name: '뒤로' }));
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(navigation.current()).toBe('/');
  });

  it('주소로 바로 들어온 상세에서 뒤로 가면 한 단계 위(목록)로 간다', async () => {
    const navigation = createMemoryNavigation('/projects/first');
    const { user } = renderApp(navigation);
    const page = within(await screen.findByRole('main', { name: '프로젝트' }));
    await page.findByRole('heading', { level: 1, name: '첫 프로젝트' });
    await user.click(page.getByRole('button', { name: '뒤로' }));
    await page.findByRole('list', { name: '프로젝트 목록' });
    expect(navigation.back()).toBe(false);
  });

  it('쓸 수 없는 페이지 주소는 워크플로 화면을 보여 준다', async () => {
    render(
      <App
        platform={{ ...createFakePlatform(), navigation: createMemoryNavigation('/users') }}
        initialPreferences={{ locale: 'ko', theme: 'light' }}
      />,
    );
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: '사용자' })).not.toBeInTheDocument();
  });
});

describe('페이지 안 포커스', () => {
  it('새 프로젝트 폼을 취소하면 "새 프로젝트" 버튼으로 포커스가 돌아온다', async () => {
    const { user } = renderApp();
    await screen.findByText('저장 완료');
    await user.click(menu('프로젝트'));
    const page = within(await screen.findByRole('main', { name: '프로젝트' }));

    await user.click(page.getByRole('button', { name: '새 프로젝트' }));
    await user.click(page.getByRole('button', { name: '취소' }));
    expect(page.getByRole('button', { name: '새 프로젝트' })).toHaveFocus();
  });

  it('새 프로젝트를 만들면 상세 페이지의 제목으로 포커스가 간다', async () => {
    const { user } = renderApp();
    await screen.findByText('저장 완료');
    await user.click(menu('프로젝트'));
    const page = within(await screen.findByRole('main', { name: '프로젝트' }));

    await user.click(page.getByRole('button', { name: '새 프로젝트' }));
    await user.type(page.getByRole('textbox', { name: '이름' }), '모바일 앱');
    await user.click(page.getByRole('button', { name: '만들기' }));
    await waitFor(() => expect(page.getByRole('heading', { level: 1, name: '모바일 앱' })).toHaveFocus());
  });

  it('사용자를 만든 뒤 "새 사용자" 버튼으로 포커스가 돌아온다', async () => {
    const { user } = renderApp();
    await screen.findByText('저장 완료');
    await user.click(menu('사용자'));
    const page = within(await screen.findByRole('main', { name: '사용자' }));
    await page.findByText('사용자가 없습니다.');

    await user.click(page.getByRole('button', { name: '새 사용자' }));
    await user.type(page.getByRole('textbox', { name: '이메일' }), 'kim@example.com');
    await user.type(page.getByRole('textbox', { name: '이름' }), '김개발');
    await user.type(page.getByLabelText(/^처음 비밀번호/), 'password1');
    await user.click(page.getByRole('button', { name: '만들기' }));
    await page.findByRole('list', { name: '사용자 목록' });
    expect(page.getByRole('button', { name: '새 사용자' })).toHaveFocus();
  });

  it('사용자 편집을 마치면 편집 버튼으로, 비활성화로 버튼이 사라지면 페이지 안으로 포커스가 간다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    await backend.userRepository.create({ email: 'kim@example.com', name: '김개발', password: 'password1' });
    await user.click(menu('사용자'));
    const page = within(await screen.findByRole('main', { name: '사용자' }));

    await user.click(await page.findByRole('button', { name: '김개발 편집' }));
    await user.click(page.getByRole('button', { name: '취소' }));
    expect(page.getByRole('button', { name: '김개발 편집' })).toHaveFocus();

    await user.click(page.getByRole('button', { name: '김개발 비활성화' }));
    await page.findByText('사용자가 없습니다.');
    await expectFocusInside('사용자');
  });
});
