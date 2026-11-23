import { expect, it, vi } from 'vitest';
import { createAuthClient } from './authRepository';

const admin = { id: 'u1', email: 'root@example.com', name: '관리자', active: true, isAdmin: true, version: 0 };
const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });
const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

it('상태·초기 설정·로그인·로그아웃·비밀번호 변경을 요청한다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ setupRequired: true, user: null }))
    .mockImplementationOnce(respond(admin, 201))
    .mockImplementationOnce(respond({ setupRequired: false, user: admin }))
    .mockImplementationOnce(respond(admin))
    .mockImplementationOnce(respond(undefined, 204))
    .mockImplementationOnce(respond(undefined, 204));
  const { authRepository } = createAuthClient(request);

  await expect(authRepository.status()).resolves.toEqual({ setupRequired: true });
  expect(request).toHaveBeenLastCalledWith('/api/v1/auth/status', {});
  const input = { email: 'root@example.com', name: '관리자', password: 'password1' };
  await expect(authRepository.setup(input)).resolves.toEqual(admin);
  expect(request).toHaveBeenLastCalledWith('/api/v1/auth/setup', json(input));
  await expect(authRepository.status()).resolves.toEqual({ setupRequired: false, user: admin });

  await expect(authRepository.login('root@example.com', 'password1')).resolves.toEqual(admin);
  expect(request).toHaveBeenLastCalledWith(
    '/api/v1/auth/login',
    json({ email: 'root@example.com', password: 'password1' }),
  );
  await authRepository.changePassword('password1', 'password2');
  expect(request).toHaveBeenLastCalledWith(
    '/api/v1/auth/password',
    json({ currentPassword: 'password1', newPassword: 'password2' }),
  );
  await authRepository.logout();
  expect(request).toHaveBeenLastCalledWith('/api/v1/auth/logout', { method: 'POST' });
});

it('로그인 실패의 이유를 구분한다', async () => {
  const failing = (code: string, status: number) =>
    createAuthClient(vi.fn<typeof fetch>().mockImplementation(respond({ error: { code, message: 'x' } }, status)))
      .authRepository;
  await expect(failing('invalidCredentials', 401).login('a@b.co', 'x')).rejects.toMatchObject({
    kind: 'invalidCredentials',
  });
  await expect(failing('tooManyAttempts', 429).login('a@b.co', 'x')).rejects.toMatchObject({
    kind: 'tooManyAttempts',
  });
  await expect(
    failing('conflict', 409).setup({ email: 'a@b.co', name: 'x', password: 'password1' }),
  ).rejects.toMatchObject({ kind: 'conflict' });
});

it('다른 요청이 401을 받으면 세션 만료를 알리고, 틀린 비밀번호는 알리지 않는다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ error: { code: 'invalidCredentials', message: 'x' } }, 401))
    .mockImplementationOnce(respond([]))
    .mockImplementationOnce(respond({ error: { code: 'unauthenticated', message: 'x' } }, 401))
    .mockImplementationOnce(respond({ error: { code: 'unauthenticated', message: 'x' } }, 401));
  const client = createAuthClient(request);
  const expired = vi.fn();
  const unsubscribe = client.authRepository.onSessionExpired(expired);

  await expect(client.authRepository.login('a@b.co', 'wrong')).rejects.toMatchObject({ kind: 'invalidCredentials' });
  expect(expired).not.toHaveBeenCalled();
  expect((await client.request('/api/v1/projects')).status).toBe(200);
  expect(expired).not.toHaveBeenCalled();
  expect((await client.request('/api/v1/projects')).status).toBe(401);
  expect(expired).toHaveBeenCalledTimes(1);

  unsubscribe();
  await client.request('/api/v1/projects');
  expect(expired).toHaveBeenCalledTimes(1);
});

it.each(['login', 'setup', 'logout'] as const)('ignores an older request 401 after successful %s', async (boundary) => {
  let release!: (response: Response) => void;
  const request: typeof fetch = async (input) => {
    if (String(input).endsWith('/old'))
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    if (String(input).endsWith('/current')) return new Response('{}', { status: 401 });
    return new Response(boundary === 'logout' ? null : JSON.stringify(admin), {
      status: boundary === 'logout' ? 204 : 200,
    });
  };
  const client = createAuthClient(request);
  let expirations = 0;
  client.authRepository.onSessionExpired(() => {
    expirations += 1;
  });
  const old = client.request('/old');
  if (boundary === 'login') await client.authRepository.login(admin.email, 'password1');
  else if (boundary === 'setup')
    await client.authRepository.setup({ email: admin.email, name: admin.name, password: 'password1' });
  else await client.authRepository.logout();
  release(new Response('{}', { status: 401 }));
  await old;
  expect(expirations).toBe(0);
  await client.request('/current');
  expect(expirations).toBe(1);
});

it('reports expiration once for concurrent requests from the same expired session', async () => {
  const releases: ((response: Response) => void)[] = [];
  const request: typeof fetch = async () =>
    new Promise<Response>((resolve) => {
      releases.push(resolve);
    });
  const client = createAuthClient(request);
  let expirations = 0;
  client.authRepository.onSessionExpired(() => {
    expirations += 1;
  });
  const first = client.request('/first');
  const second = client.request('/second');
  releases[0]!(new Response('{}', { status: 401 }));
  await first;
  releases[1]!(new Response('{}', { status: 401 }));
  await second;
  expect(expirations).toBe(1);
});

it.each(['login', 'setup', 'logout'] as const)(
  'does not expire pending %s because an earlier request returns 401',
  async (boundary) => {
    let releaseOld!: (response: Response) => void;
    let releaseAuth!: (response: Response) => void;
    let releaseDuring!: (response: Response) => void;
    const request: typeof fetch = async (input) =>
      new Promise<Response>((resolve) => {
        if (String(input) === '/old') releaseOld = resolve;
        else if (String(input) === '/during') releaseDuring = resolve;
        else releaseAuth = resolve;
      });
    const client = createAuthClient(request);
    let expirations = 0;
    client.authRepository.onSessionExpired(() => {
      expirations += 1;
    });
    const old = client.request('/old');
    const authentication =
      boundary === 'login'
        ? client.authRepository.login(admin.email, 'password1')
        : boundary === 'setup'
          ? client.authRepository.setup({ email: admin.email, name: admin.name, password: 'password1' })
          : client.authRepository.logout();
    releaseOld(new Response('{}', { status: 401 }));
    await old;
    expect(expirations).toBe(0);
    const during = client.request('/during');
    releaseAuth(
      new Response(boundary === 'logout' ? null : JSON.stringify(admin), { status: boundary === 'logout' ? 204 : 200 }),
    );
    await authentication;
    releaseDuring(new Response('{}', { status: 401 }));
    await during;
    expect(expirations).toBe(0);
  },
);

it('keeps expiration detection active across an authenticated status read', async () => {
  let release!: (response: Response) => void;
  const request: typeof fetch = async (input) =>
    String(input) === '/old'
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : new Response(JSON.stringify({ setupRequired: false, user: admin }));
  const client = createAuthClient(request);
  let expirations = 0;
  client.authRepository.onSessionExpired(() => {
    expirations += 1;
  });
  const old = client.request('/old');
  await client.authRepository.status();
  release(new Response('{}', { status: 401 }));
  await old;
  expect(expirations).toBe(1);
});
