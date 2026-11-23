/// <reference types="node" />
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { STANDARD_PROCESS } from '@process-flow/domain';
import { App } from '../App';
import { createFakePlatform } from './fakePlatform';
import { openAdditionalRecords, fillTaskDocument } from './taskDocuments';
import { createWorkflowRepository } from '@process-flow/adapter-http';
import { createWorkflowIdentity } from '@process-flow/adapter-browser';

it.runIf(process.env['TEST_BACKEND'] === '1')(
  '실제 DB 저장 → 서버 재시작 → 앱 재마운트로 같은 워크플로 복원',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'process-flow-web-'));
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const base = `http://127.0.0.1:${address.port}`;
    let server: ChildProcess | undefined;
    let cookie = '';
    const api: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      if (cookie) headers.set('Cookie', cookie);
      return fetch(input, { ...init, headers });
    };
    const stop = async () => {
      if (server && server.exitCode === null) {
        const exited = once(server, 'exit');
        server.kill('SIGTERM');
        await exited;
      }
    };
    const start = async () => {
      server = spawn(resolve('../backend/target/debug/process-flow-server'), [], {
        cwd: directory,
        env: {
          ...process.env,
          APP_HOST: '127.0.0.1',
          APP_PORT: String(address.port),
          APP_WORKERS: '1',
          SQLITE_URL: `sqlite://${directory}/data/process-flow.sqlite3`,
          LANCEDB_URI: join(directory, 'data/search.lancedb'),
        },
        stdio: 'ignore',
      });
      await waitFor(
        async () => {
          expect((await api(`${base}/health`)).ok).toBe(true);
        },
        { timeout: 30000 },
      );
    };
    const mount = () =>
      render(
        <StrictMode>
          <App
            platform={{
              ...createFakePlatform(),
              workflowRepository: createWorkflowRepository(createWorkflowIdentity(), api, `${base}/api/v1`),
            }}
          />
        </StrictMode>,
      );
    try {
      localStorage.clear();
      window.history.replaceState(null, '', '/');
      await start();
      expect((await api(`${base}/api/v1/projects`)).status).toBe(401);
      const setup = await fetch(`${base}/api/v1/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@example.com', name: 'Admin', password: 'persistence-password' }),
      });
      expect(setup.status).toBe(201);
      cookie = setup.headers.getSetCookie()[0]!.split(';')[0]!;
      const user = userEvent.setup();
      const blank = mount();
      await screen.findByRole('heading', { level: 1, name: '열린 워크플로가 없습니다' });
      expect(await (await api(`${base}/api/v1/projects`)).json()).toEqual([]);
      expect(await (await api(`${base}/api/v1/workflows`)).json()).toEqual([]);
      blank.unmount();
      const post = async (path: string, body: unknown) =>
        (
          await api(`${base}/api/v1${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
        ).json();
      const project = await post('/projects', { name: '저장 테스트' });
      const started = await post(`/projects/${project.id}/workflows`, { name: '저장 워크플로' });
      const id: string = started.id;
      window.history.replaceState(null, '', `/?workflow=${encodeURIComponent(id)}`);
      const app = mount();
      await screen.findByText('저장 완료');
      await user.click(screen.getByRole('tab', { name: '작업' }));
      for (const task of STANDARD_PROCESS.stages[0]!.tasks) {
        await fillTaskDocument(user, task.id);
        await user.click(screen.getByRole('button', { name: /완료하고 다음 작업으로|완료하고 단계 승인 요청/ }));
        await screen.findByText(`전체 진행 ${task.number} / 25`);
        await screen.findByText('저장 완료');
      }
      await user.click(screen.getByRole('tab', { name: '단계' }));
      await user.click(screen.getByRole('button', { name: '승인하고 다음 단계 열기' }));
      await screen.findByRole('heading', { name: '설계·디자인', level: 2 });
      await screen.findByText('저장 완료');
      const preferencesUrl = `${base}/api/v1/workflows/${id}/preferences`;
      await waitFor(async () => {
        const saved = await (await api(preferencesUrl)).json();
        expect(saved.selectedTaskId).toBe('wireframes');
      });
      await user.click(screen.getByRole('tab', { name: '작업' }));
      openAdditionalRecords();
      await user.type(screen.getByRole('textbox', { name: '메모' }), 'Persistent note');
      openAdditionalRecords();
      await user.type(screen.getByRole('textbox', { name: '산출물 링크' }), 'https://example.com/artifact');
      await screen.findByText('저장 완료', {}, { timeout: 10000 });
      await user.click(screen.getByRole('button', { name: '설정' }));
      await user.click(
        within(await screen.findByRole('dialog', { name: '설정' })).getByRole('radio', { name: /English/ }),
      );
      await user.click(screen.getByRole('radio', { name: /Dark/ }));
      await waitFor(async () => {
        const saved = await (await api(preferencesUrl)).json();
        expect(saved).toEqual({ locale: 'en', theme: 'dark', view: 'task', selectedTaskId: 'wireframes' });
      });
      app.unmount();
      await stop();
      await start();
      const restored = mount();
      await screen.findByText('Saved');
      expect(screen.getByRole('tab', { name: 'Tasks' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('heading', { name: 'Wireframes', level: 2 })).toBeInTheDocument();
      openAdditionalRecords();
      expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Persistent note');
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      await user.click(
        within(await screen.findByRole('dialog', { name: 'Settings' })).getByRole('radio', { name: /한국어/ }),
      );
      await user.keyboard('{Escape}');
      expect(new URL(window.location.href).searchParams.get('workflow')).toBe(id);
      expect(screen.getByText('전체 진행 7 / 25')).toBeInTheDocument();
      const detail = await (await api(`${base}/api/v1/workflows/${id}`)).json();
      expect(detail.unlockedStage).toBe(1);
      expect(detail.records.wireframes).toEqual({ note: 'Persistent note', link: 'https://example.com/artifact' });
      const workflows = await (await api(`${base}/api/v1/workflows`)).json();
      expect(workflows).toHaveLength(1);
      await user.click(screen.getByRole('tab', { name: '작업' }));
      await user.click(screen.getByRole('button', { name: /2\. 설계·디자인/ }));
      await user.click(screen.getByRole('button', { name: /8\. 와이어프레임/ }));
      openAdditionalRecords();
      expect(screen.getByRole('textbox', { name: '메모' })).toHaveValue('Persistent note');
      restored.unmount();
    } finally {
      await stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60000,
);
