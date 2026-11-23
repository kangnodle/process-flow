import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../App';
import type { Role } from '@process-flow/domain';
import { createFakePlatform } from './fakePlatform';
import { createFakeBackend } from './fakeProjects';
import { openAdditionalRecords, fillTaskDocument } from './taskDocuments';

const renderApp = (role: Role) => {
  const user = userEvent.setup();
  const backend = createFakeBackend({ role });
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

const openProject = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: '프로젝트' }));
  const panel = within(await screen.findByRole('main', { name: '프로젝트' }));
  await user.click(await panel.findByRole('button', { name: /첫 프로젝트/ }));
  await panel.findByRole('heading', { name: '첫 프로젝트' });
  return panel;
};

describe('보기 전용 역할', () => {
  it('워크플로를 볼 수 있지만 완료·기록·승인은 할 수 없다', async () => {
    const { user } = renderApp('viewer');
    await screen.findByText('저장 완료');
    expect(screen.getByText(/보기 전용 역할입니다/)).toBeInTheDocument();

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '작업' }));
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '산출물 링크' })).toBeDisabled();
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeDisabled();
    const complete = screen.getByRole('button', { name: '완료하고 다음 작업으로' });
    expect(complete).toHaveAttribute('aria-disabled', 'true');
    expect(complete).toHaveAccessibleDescription('읽기 전용이므로 바꿀 수 없습니다.');
    await user.click(complete);
    expect(screen.getByText('저장 완료')).toBeInTheDocument();
    expect(screen.getByText(/0\s*\/\s*25/)).toBeInTheDocument();
  });

  it('프로젝트 패널에서 역할을 보여 주고 바꾸는 동작을 숨긴다', async () => {
    const { user, backend } = renderApp('viewer');
    await screen.findByText('저장 완료');
    backend.setRole('owner');
    const kim = await backend.userRepository.create({
      email: 'kim@example.com',
      name: '김개발',
      password: 'password1',
    });
    await backend.userRepository.putMember('first', kim.id, 'owner');
    backend.setRole('viewer');

    const panel = await openProject(user);
    expect(panel.getByText('내 역할: 보기 전용')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '편집' })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '보관' })).not.toBeInTheDocument();
    expect(panel.queryByRole('form', { name: '새 워크플로' })).not.toBeInTheDocument();

    const members = within(await panel.findByRole('list', { name: '멤버' }));
    expect(members.getByText('김개발')).toBeInTheDocument();
    expect(members.getByText('소유자')).toBeInTheDocument();
    expect(panel.getByText('멤버를 넣고 바꾸는 일은 소유자만 할 수 있습니다.')).toBeInTheDocument();
    expect(panel.queryByRole('combobox', { name: '김개발의 역할' })).not.toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '김개발 빼기' })).not.toBeInTheDocument();
    expect(panel.queryByRole('form', { name: '멤버 추가' })).not.toBeInTheDocument();
  });
});

describe('편집자 역할', () => {
  it('워크플로를 진행하고 시작하지만, 프로젝트와 멤버는 고칠 수 없다', async () => {
    const { user } = renderApp('editor');
    await screen.findByText('저장 완료');
    expect(screen.queryByText(/보기 전용 역할입니다/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '작업' }));
    await fillTaskDocument(user, 'goals');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));
    expect(await screen.findByText(/1\s*\/\s*25/)).toBeInTheDocument();

    const panel = await openProject(user);
    expect(panel.getByText('내 역할: 편집자')).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: '편집' })).not.toBeInTheDocument();
    expect(panel.getByRole('form', { name: '새 워크플로' })).toBeInTheDocument();
    expect(panel.queryByRole('form', { name: '멤버 추가' })).not.toBeInTheDocument();
  });
});

describe('쓰는 도중 역할이 바뀌면', () => {
  it('저장되지 않은 변경을 버리고 서버 상태로 돌아가 알린다', async () => {
    const { user, backend } = renderApp('editor');
    await screen.findByText('저장 완료');
    await user.click(screen.getByRole('tab', { name: '작업' }));
    await fillTaskDocument(user, 'goals');
    await screen.findByText('저장 완료');
    backend.setRole('viewer');
    await user.click(screen.getByRole('button', { name: '완료하고 다음 작업으로' }));

    expect(await screen.findByText(/방금 변경은 저장되지 않았습니다/)).toBeInTheDocument();
    expect(screen.getByText(/보기 전용 역할입니다/)).toBeInTheDocument();
    expect(screen.getByText(/0\s*\/\s*25/)).toBeInTheDocument();
    openAdditionalRecords();
    expect(screen.getByRole('textbox', { name: '메모' })).toBeDisabled();
    for (const field of within(screen.getByRole('region', { name: '작업 문서' })).getAllByRole('textbox'))
      expect(field).toBeDisabled();
  });
});
