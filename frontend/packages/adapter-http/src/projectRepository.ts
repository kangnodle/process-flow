import {
  isPermission,
  isRole,
  isValidPhase,
  type Project,
  STANDARD_PROCESS,
  type WorkflowSummary,
} from '@process-flow/domain';
import { RequestError, type ProjectRepository } from '@process-flow/application';
import { createJsonCall, decodeList } from './jsonClient';

function decodeProject(value: unknown): Project {
  const dto = (value ?? {}) as Record<string, unknown>;
  const { id, name, description, archived, version, role, permissions } = dto;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof name !== 'string' ||
    typeof description !== 'string' ||
    typeof archived !== 'boolean' ||
    !Number.isInteger(version) ||
    !isRole(role) ||
    !Array.isArray(permissions)
  ) {
    throw new RequestError('unknown', 'Invalid project response');
  }
  return {
    id,
    name,
    description,
    archived,
    version: version as number,
    role,
    permissions: permissions.filter(isPermission),
  };
}

function decodeWorkflow(value: unknown): WorkflowSummary {
  const dto = (value ?? {}) as Record<string, unknown>;
  const { id, projectId, name, phase, processId } = dto;
  if (
    typeof id !== 'string' ||
    !id ||
    typeof projectId !== 'string' ||
    typeof name !== 'string' ||
    processId !== 'standard' ||
    !isValidPhase(STANDARD_PROCESS, phase)
  ) {
    throw new RequestError('unknown', 'Invalid workflow response');
  }
  return { id, projectId, name, phase };
}

export function createProjectRepository(request: typeof fetch = fetch, base = '/api/v1'): ProjectRepository {
  const call = createJsonCall(request, base);
  const project = (id: string) => `/projects/${encodeURIComponent(id)}`;
  return {
    async list(includeArchived) {
      return decodeList(await call(includeArchived ? '/projects?includeArchived=true' : '/projects'), decodeProject);
    },
    async get(id) {
      return decodeProject(await call(project(id)));
    },
    async create(input) {
      return decodeProject(await call('/projects', 'POST', input));
    },
    async update(id, expectedVersion, patch) {
      return decodeProject(await call(project(id), 'PATCH', { expectedVersion, ...patch }));
    },
    async deleteArchived(id, expectedVersion) {
      await call(`${project(id)}/permanent`, 'DELETE', { expectedVersion });
    },
    async workflows(projectId) {
      return decodeList(await call(`${project(projectId)}/workflows`), decodeWorkflow);
    },
    async startWorkflow(projectId, name) {
      return decodeWorkflow(await call(`${project(projectId)}/workflows`, 'POST', name?.trim() ? { name } : {}));
    },
  };
}
