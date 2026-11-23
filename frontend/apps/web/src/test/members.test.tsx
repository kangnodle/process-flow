import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';

const renderApp = () => {
  const user = userEvent.setup();
  const backend = createFakeBackend();
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
  return { user, backend };
};

describe('사용자 패널', () => {
  it('사용자를 만들고, 이메일 중복을 알리고, 편집·비활성화한다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    await user.click(screen.getByRole('button', { name: '사용자' }));
    const panel = within(await screen.findByRole('main', { name: '사용자' }));
    expect(await panel.findByText('사용자가 없습니다.')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: '새 사용자' }));
    await user.click(panel.getByRole('button', { name: '만들기' }));
    expect(panel.getByText('올바른 이메일 주소를 적어 주세요.')).toBeInTheDocument();
    await user.type(panel.getByRole('textbox', { name: '이메일' }), ' Kim@Example.com ');
    await user.type(panel.getByRole('textbox', { name: '이름' }), '김개발');
    await user.type(panel.getByLabelText(/^처음 비밀번호/), 'short');
    await user.click(panel.getByRole('button', { name: '만들기' }));
    expect(panel.getByText('비밀번호는 8자 이상으로 적어 주세요.')).toBeInTheDocument();
    await user.type(panel.getByLabelText(/^처음 비밀번호/), '-password');
    await user.click(panel.getByRole('button', { name: '만들기' }));
    const list = within(await panel.findByRole('list', { name: '사용자 목록' }));
    expect(list.getByText('kim@example.com')).toBeInTheDocument();

    await user.click(panel.getByRole('button', { name: '새 사용자' }));
    await user.type(panel.getByRole('textbox', { name: '이메일' }), 'kim@example.com');
    await user.type(panel.getByRole('textbox', { name: '이름' }), '중복');
    await user.type(panel.getByLabelText(/^처음 비밀번호/), 'password1');
    await user.click(panel.getByRole('button', { name: '만들기' }));
    expect(await panel.findByText('이미 쓰는 이메일입니다.')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '취소' }));

    await user.click(panel.getByRole('button', { name: '김개발 편집' }));
    const name = panel.getByRole('textbox', { name: '이름' });
    await user.clear(name);
    await user.type(name, '김개발자');
    await user.click(panel.getByRole('button', { name: '저장' }));
    expect(await panel.findByText('김개발자')).toBeInTheDocument();
    expect(backend.passwordOf('kim@example.com')).toBe('short-password');

    await user.click(panel.getByRole('button', { name: '김개발자 편집' }));
    await user.click(panel.getByRole('switch', { name: '관리자 권한' }));
    await user.type(panel.getByLabelText(/^새 비밀번호/), 'new-password');
    await user.click(panel.getByRole('button', { name: '저장' }));
    expect(await panel.findByText('관리자')).toBeInTheDocument();
    expect(backend.passwordOf('kim@example.com')).toBe('new-password');

    await user.click(panel.getByRole('button', { name: '김개발자 비활성화' }));
    expect(await panel.findByText(/마지막 관리자는/)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '김개발자 편집' }));
    await user.click(panel.getByRole('switch', { name: '관리자 권한' }));
    await user.click(panel.getByRole('button', { name: '저장' }));
    expect(await panel.findByText(/마지막 관리자는/)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '취소' }));
    const lee = await backend.userRepository.create({
      email: 'lee@example.com',
      name: '이디자인',
      password: 'password1',
    });
    await backend.userRepository.update(lee.id, lee.version, { isAdmin: true });
    await user.click(panel.getByRole('button', { name: '김개발자 편집' }));
    await user.click(panel.getByRole('switch', { name: '관리자 권한' }));
    await user.click(panel.getByRole('button', { name: '저장' }));
    await panel.findByText('이디자인');

    await user.click(panel.getByRole('button', { name: '김개발자 비활성화' }));
    await waitFor(() => expect(panel.queryByText('김개발자')).not.toBeInTheDocument());
    await user.click(panel.getByRole('switch', { name: '비활성 사용자 표시' }));
    expect(await panel.findByText('비활성')).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: '김개발자 다시 활성화' }));
    expect(await panel.findByRole('button', { name: '김개발자 비활성화' })).toBeInTheDocument();
  });
});

describe('프로젝트 멤버', () => {
  it('멤버를 넣고 역할을 바꾸며, 마지막 소유자는 지킨다', async () => {
    const { user, backend } = renderApp();
    await screen.findByText('저장 완료');
    await backend.userRepository.create({ email: 'kim@example.com', name: '김개발', password: 'password1' });
    await backend.userRepository.create({ email: 'lee@example.com', name: '이디자인', password: 'password1' });

    await user.click(screen.getByRole('button', { name: '프로젝트' }));
    const panel = within(await screen.findByRole('main', { name: '프로젝트' }));
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    expect(await panel.findByText('아직 멤버가 없습니다.')).toBeInTheDocument();

    const add = within(panel.getByRole('form', { name: '멤버 추가' }));
    expect(add.getByRole('button', { name: '멤버 추가' })).toBeDisabled();
    await user.selectOptions(add.getByRole('combobox', { name: '사용자' }), '김개발 (kim@example.com)');
    await user.selectOptions(add.getByRole('combobox', { name: '역할' }), '소유자');
    await user.click(add.getByRole('button', { name: '멤버 추가' }));
    const members = within(await panel.findByRole('list', { name: '멤버' }));
    expect(members.getByRole('combobox', { name: '김개발의 역할' })).toHaveValue('owner');

    await user.selectOptions(
      within(panel.getByRole('form', { name: '멤버 추가' })).getByRole('combobox', { name: '사용자' }),
      '이디자인 (lee@example.com)',
    );
    await user.click(within(panel.getByRole('form', { name: '멤버 추가' })).getByRole('button', { name: '멤버 추가' }));
    expect(await panel.findByRole('combobox', { name: '이디자인의 역할' })).toHaveValue('editor');
    expect(panel.getByText(/추가할 수 있는 활성 사용자가 없습니다/)).toBeInTheDocument();

    await user.selectOptions(panel.getByRole('combobox', { name: '김개발의 역할' }), '보기 전용');
    expect(await panel.findByText(/마지막 소유자는 빼거나 역할을 낮출 수 없습니다/)).toBeInTheDocument();
    expect(panel.getByRole('combobox', { name: '김개발의 역할' })).toHaveValue('owner');
    await user.click(panel.getByRole('button', { name: '김개발 빼기' }));
    expect(await panel.findByText(/마지막 소유자는/)).toBeInTheDocument();

    await user.selectOptions(panel.getByRole('combobox', { name: '이디자인의 역할' }), '소유자');
    await user.click(await panel.findByRole('button', { name: '김개발 빼기' }));
    await screen.findByRole('combobox', { name: '이디자인의 역할' });
    expect(panel.queryByRole('combobox', { name: '김개발의 역할' })).not.toBeInTheDocument();
  });

  it('사용자 저장소가 없으면 사용자 버튼과 멤버 영역이 없다', async () => {
    const user = userEvent.setup();
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
    expect(screen.queryByRole('button', { name: '사용자' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '프로젝트' }));
    const panel = within(await screen.findByRole('main', { name: '프로젝트' }));
    await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
    await panel.findByRole('heading', { name: '첫 프로젝트' });
    expect(panel.queryByRole('heading', { name: '멤버' })).not.toBeInTheDocument();
  });
});
