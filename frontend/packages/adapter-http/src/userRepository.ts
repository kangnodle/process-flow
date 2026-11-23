import { RequestError, type UserRepository } from '@process-flow/application';
import { isRole, type Member, type User } from '@process-flow/domain';
import { createJsonCall, decodeList } from './jsonClient';

export function decodeUser(value: unknown): User {
  const { id, email, name, active, isAdmin, version } = (value ?? {}) as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof email !== 'string' ||
    typeof name !== 'string' ||
    typeof active !== 'boolean' ||
    typeof isAdmin !== 'boolean' ||
    !Number.isInteger(version)
  ) {
    throw new RequestError('unknown', 'Invalid user response');
  }
  return { id, email, name, active, isAdmin, version: version as number };
}

function decodeMember(value: unknown): Member {
  const { role, user } = (value ?? {}) as Record<string, unknown>;
  if (!isRole(role)) throw new RequestError('unknown', 'Invalid member response');
  return { role, user: decodeUser(user) };
}

export function createUserRepository(request: typeof fetch = fetch, base = '/api/v1'): UserRepository {
  const call = createJsonCall(request, base);
  const user = (id: string) => `/users/${encodeURIComponent(id)}`;
  const member = (projectId: string, userId: string) =>
    `/projects/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`;
  return {
    async list(includeInactive) {
      return decodeList(await call(includeInactive ? '/users?includeInactive=true' : '/users'), decodeUser);
    },
    async create(input) {
      return decodeUser(await call('/users', 'POST', input));
    },
    async update(id, expectedVersion, patch) {
      return decodeUser(await call(user(id), 'PATCH', { expectedVersion, ...patch }));
    },
    async setPassword(id, password) {
      await call(`${user(id)}/password`, 'PUT', { password });
    },
    async members(projectId) {
      return decodeList(await call(`/projects/${encodeURIComponent(projectId)}/members`), decodeMember);
    },
    async putMember(projectId, userId, role) {
      return decodeMember(await call(member(projectId, userId), 'PUT', { role }));
    },
    async removeMember(projectId, userId) {
      await call(member(projectId, userId), 'DELETE');
    },
  };
}
