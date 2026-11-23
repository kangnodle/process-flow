import { expect, it, vi } from 'vitest';
import { RequestError } from '@process-flow/application';
import { createUserRepository } from './userRepository';

const kim = { id: 'u1', email: 'kim@example.com', name: '김개발', active: true, isAdmin: false, version: 0 };
const respond =
  (body: unknown, status = 200) =>
  async () =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

it('사용자 목록과 만들기', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond([kim]))
    .mockImplementationOnce(respond(kim));
  const repository = createUserRepository(request);
  await expect(repository.list(true)).resolves.toEqual([kim]);
  expect(request).toHaveBeenCalledWith('/api/v1/users?includeInactive=true', {});
  await repository.create({ email: 'kim@example.com', name: '김개발', password: 'password1' });
  expect(request).toHaveBeenLastCalledWith('/api/v1/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kim@example.com', name: '김개발', password: 'password1' }),
  });
});

it('멤버 넣기·빼기는 PUT·DELETE를 쓰고 204 응답을 받는다', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ role: 'owner', user: kim }))
    .mockImplementationOnce(respond(undefined, 204));
  const repository = createUserRepository(request);
  await expect(repository.putMember('p 1', 'u1', 'owner')).resolves.toEqual({ role: 'owner', user: kim });
  expect(request).toHaveBeenCalledWith('/api/v1/projects/p%201/members/u1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'owner' }),
  });
  await expect(repository.removeMember('p1', 'u1')).resolves.toBeUndefined();
  expect(request).toHaveBeenLastCalledWith('/api/v1/projects/p1/members/u1', { method: 'DELETE' });
});

it('마지막 소유자 충돌과 모르는 역할을 거절한다', async () => {
  const conflict = vi
    .fn<typeof fetch>()
    .mockImplementation(respond({ error: { code: 'conflict', message: 'x' } }, 409));
  await expect(createUserRepository(conflict).removeMember('p1', 'u1')).rejects.toMatchObject({ kind: 'conflict' });
  const unknownRole = vi.fn<typeof fetch>().mockImplementation(respond([{ role: 'admin', user: kim }]));
  await expect(createUserRepository(unknownRole).members('p1')).rejects.toBeInstanceOf(RequestError);
});

it('관리자 지정과 비밀번호 지정, 권한 오류', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockImplementationOnce(respond({ ...kim, isAdmin: true, version: 1 }))
    .mockImplementationOnce(respond(undefined, 204))
    .mockImplementationOnce(respond({ error: { code: 'forbidden', message: 'x' } }, 403));
  const repository = createUserRepository(request);
  await expect(repository.update('u1', 0, { isAdmin: true })).resolves.toMatchObject({ isAdmin: true });
  await expect(repository.setPassword('u 1', 'password2')).resolves.toBeUndefined();
  expect(request).toHaveBeenLastCalledWith('/api/v1/users/u%201/password', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'password2' }),
  });
  await expect(repository.setPassword('u1', 'password2')).rejects.toMatchObject({ kind: 'forbidden' });
  const old = vi.fn<typeof fetch>().mockImplementation(respond([{ ...kim, isAdmin: undefined }]));
  await expect(createUserRepository(old).list(false)).rejects.toBeInstanceOf(RequestError);
});
