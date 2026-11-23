import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import { createFakeAuth } from './fakeAuth';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';

type Auth = ReturnType<typeof createFakeAuth>;

const ADMIN = { email: 'root@example.com', name: '관리자', password: 'password1', isAdmin: true };
const MEMBER = { email: 'kim@example.com', name: '김개발', password: 'password1' };

const renderApp = (auth: Auth) => {
  const user = userEvent.setup();
  const backend = createFakeBackend();
  const platform = createFakePlatform();
  render(
    <App
      platform={{
        ...platform,
        authRepository: auth.authRepository,
        workflowRepository: backend.workflowRepository,
        projectRepository: backend.projectRepository,
        userRepository: backend.userRepository,
      }}
      initialPreferences={{ locale: 'ko', theme: 'light' }}
    />,
  );
  return { user, backend, platform };
};

const signIn = async (user: ReturnType<typeof userEvent.setup>, email: string, password: string) => {
  await user.type(await screen.findByRole('textbox', { name: '이메일' }), email);
  await user.type(screen.getByLabelText(/^비밀번호/), password);
  await user.click(screen.getByRole('button', { name: '로그인' }));
};

describe('초기 설정', () => {
  it('관리자가 없으면 첫 관리자를 만들고 바로 앱에 들어간다', async () => {
    const auth = createFakeAuth();
    const { user, platform } = renderApp(auth);
    expect(await screen.findByRole('heading', { name: '초기 설정' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '프로젝트' })).not.toBeInTheDocument();
    expect(platform.language()).toBe('ko');

    await user.click(screen.getByRole('button', { name: '관리자 계정 만들기' }));
    expect(screen.getByText('올바른 이메일 주소를 적어 주세요.')).toBeInTheDocument();
    expect(screen.getByText('비밀번호는 8자 이상으로 적어 주세요.')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: '이메일' }), ' Root@Example.com ');
    await user.type(screen.getByRole('textbox', { name: '이름' }), '관리자');
    await user.type(screen.getByLabelText(/^비밀번호(?! 확인)/), 'password1');
    await user.type(screen.getByLabelText(/^비밀번호 확인/), 'password2');
    await user.click(screen.getByRole('button', { name: '관리자 계정 만들기' }));
    expect(screen.getByText('두 비밀번호가 서로 다릅니다.')).toBeInTheDocument();
    expect(auth.signedInAs()).toBeUndefined();

    await user.clear(screen.getByLabelText(/^비밀번호 확인/));
    await user.type(screen.getByLabelText(/^비밀번호 확인/), 'password1');
    await user.click(screen.getByRole('button', { name: '관리자 계정 만들기' }));
    await screen.findByText('저장 완료');
    expect(auth.signedInAs()).toBe('root@example.com');
    expect(screen.getByRole('button', { name: '관리자 계정' })).toBeInTheDocument();
  });

  it('브라우저 언어가 영어여도 한국어를 골라 설정하고, 들어간 뒤에도 한국어로 보인다', async () => {
    const auth = createFakeAuth();
    const user = userEvent.setup();
    const backend = createFakeBackend();
    const platform = createFakePlatform({ preferredLanguages: ['en-US'] });
    render(
      <App
        platform={{
          ...platform,
          authRepository: auth.authRepository,
          workflowRepository: backend.workflowRepository,
          projectRepository: backend.projectRepository,
          userRepository: backend.userRepository,
        }}
      />,
    );
    expect(await screen.findByRole('heading', { name: 'First-time setup' })).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), '한국어');
    expect(screen.getByRole('heading', { name: '초기 설정' })).toBeInTheDocument();
    expect(platform.language()).toBe('ko');

    await user.type(screen.getByRole('textbox', { name: '이메일' }), 'root@example.com');
    await user.type(screen.getByRole('textbox', { name: '이름' }), '관리자');
    await user.type(screen.getByLabelText(/^비밀번호(?! 확인)/), 'password1');
    await user.type(screen.getByLabelText(/^비밀번호 확인/), 'password1');
    await user.click(screen.getByRole('button', { name: '관리자 계정 만들기' }));
    await screen.findByText('저장 완료');
    expect(platform.language()).toBe('ko');
  });

  it('그 사이 다른 사람이 설정을 마쳤으면 로그인 화면으로 바꾼다', async () => {
    const auth = createFakeAuth();
    const { user } = renderApp(auth);
    await screen.findByRole('heading', { name: '초기 설정' });
    auth.addAdmin('first@example.com', 'password1');
    await user.type(screen.getByRole('textbox', { name: '이메일' }), 'late@example.com');
    await user.type(screen.getByRole('textbox', { name: '이름' }), '늦은 사람');
    await user.type(screen.getByLabelText(/^비밀번호(?! 확인)/), 'password1');
    await user.type(screen.getByLabelText(/^비밀번호 확인/), 'password1');
    await user.click(screen.getByRole('button', { name: '관리자 계정 만들기' }));
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument();
    expect(auth.signedInAs()).toBeUndefined();
  });
});

describe('로그인', () => {
  it('틀린 비밀번호를 알리고, 맞으면 앱에 들어가며, 로그아웃하면 돌아온다', async () => {
    const auth = createFakeAuth({ accounts: [ADMIN] });
    const { user } = renderApp(auth);
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeDisabled();

    await signIn(user, 'root@example.com', 'wrong-password');
    expect(await screen.findByText('이메일 또는 비밀번호가 올바르지 않습니다.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/^비밀번호/));
    await user.type(screen.getByLabelText(/^비밀번호/), 'password1');
    await user.click(screen.getByRole('button', { name: '로그인' }));
    await screen.findByText('저장 완료');

    await user.click(screen.getByRole('button', { name: '관리자 계정' }));
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }));
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument();
    expect(auth.signedInAs()).toBeUndefined();
    expect(screen.queryByText('세션이 끝났습니다. 다시 로그인해 주세요.')).not.toBeInTheDocument();
  });

  it('이미 로그인했으면 바로 앱을 보여 주고, 세션이 끝나면 로그인 화면으로 돌아간다', async () => {
    const auth = createFakeAuth({ accounts: [ADMIN], signedIn: ADMIN.email });
    const { user } = renderApp(auth);
    await screen.findByText('저장 완료');
    expect(screen.queryByRole('heading', { name: '로그인' })).not.toBeInTheDocument();

    auth.expire();
    expect(await screen.findByText('세션이 끝났습니다. 다시 로그인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '프로젝트' })).not.toBeInTheDocument();
    await signIn(user, ADMIN.email, ADMIN.password);
    await screen.findByText('저장 완료');
  });

  it('서버에 닿지 못하면 알리고 다시 시도할 수 있다', async () => {
    const auth = createFakeAuth({ accounts: [ADMIN], failStatus: true });
    const { user } = renderApp(auth);
    expect(await screen.findByText('서버에 연결하지 못해 로그인 상태를 확인할 수 없습니다.')).toBeInTheDocument();
    auth.recover();
    await user.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument();
  });
});

describe('계정', () => {
  it('비밀번호를 바꾼다: 지금 비밀번호가 틀리면 알린다', async () => {
    const auth = createFakeAuth({ accounts: [ADMIN], signedIn: ADMIN.email });
    const { user } = renderApp(auth);
    await screen.findByText('저장 완료');
    await user.click(screen.getByRole('button', { name: '관리자 계정' }));
    await user.click(await screen.findByRole('menuitem', { name: '비밀번호 변경' }));
    const dialog = within(await screen.findByRole('dialog', { name: '비밀번호 변경' }));

    await user.type(dialog.getByLabelText(/^지금 비밀번호/), 'wrong-password');
    await user.type(dialog.getByLabelText(/^새 비밀번호/), 'short');
    await user.click(dialog.getByRole('button', { name: '비밀번호 변경' }));
    expect(dialog.getByText('비밀번호는 8자 이상으로 적어 주세요.')).toBeInTheDocument();

    await user.type(dialog.getByLabelText(/^새 비밀번호/), '-password');
    await user.type(dialog.getByLabelText(/^비밀번호 확인/), 'short-password');
    await user.click(dialog.getByRole('button', { name: '비밀번호 변경' }));
    expect(await dialog.findByText('지금 비밀번호가 올바르지 않습니다.')).toBeInTheDocument();
    expect(auth.passwordOf(ADMIN.email)).toBe('password1');

    await user.clear(dialog.getByLabelText(/^지금 비밀번호/));
    await user.type(dialog.getByLabelText(/^지금 비밀번호/), 'password1');
    await user.click(dialog.getByRole('button', { name: '비밀번호 변경' }));
    expect(await screen.findByText(/비밀번호를 바꿨습니다/)).toBeInTheDocument();
    expect(auth.passwordOf(ADMIN.email)).toBe('short-password');
    expect(screen.queryByRole('dialog', { name: '비밀번호 변경' })).not.toBeInTheDocument();
  });

  it('관리자가 아니면 사용자 목록만 보고 바꾸는 버튼이 없다', async () => {
    const auth = createFakeAuth({ accounts: [ADMIN, MEMBER], signedIn: MEMBER.email });
    const { user, backend } = renderApp(auth);
    await screen.findByText('저장 완료');
    await backend.userRepository.create({ email: 'lee@example.com', name: '이디자인', password: 'password1' });

    await user.click(screen.getByRole('button', { name: '사용자' }));
    const panel = within(await screen.findByRole('main', { name: '사용자' }));
    expect(await panel.findByText('이디자인')).toBeInTheDocument();
    expect(panel.getByText('사용자를 만들고 바꾸는 일은 관리자만 할 수 있습니다.')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '새 사용자' })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '이디자인 편집' })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '이디자인 비활성화' })).not.toBeInTheDocument();
  });
});
