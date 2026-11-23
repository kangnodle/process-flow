import { describe, expect, it } from 'vitest';
import { RequestError, type ProjectRepository, type UserRepository } from '@process-flow/application';
import { PERMISSIONS, type Project, type User } from '@process-flow/domain';
import { createManagementQuery } from './managementQuery';
import { createProjectLifecycle } from './projectLifecycle';
import { createProjectManagement, createWorkflowSwitch } from './projectManagement';
import { createUserManagement } from '../users/userManagement';
import { createMemberManagement } from '../members/memberManagement';
import { createWorkManagement } from '../work/workManagement';

const user: User = { id: 'user', name: 'Before', email: 'user@example.com', version: 2, active: true, isAdmin: false };
const saved: User = { ...user, name: 'Saved', version: 3 };
const users = (overrides: Partial<UserRepository> = {}): UserRepository => ({
  list: async () => [user],
  create: async () => saved,
  update: async () => saved,
  setPassword: async () => undefined,
  members: async () => [],
  putMember: async () => ({ user, role: 'owner' }),
  removeMember: async () => undefined,
  ...overrides,
});
const project: Project = {
  id: 'project',
  name: 'Project',
  description: '',
  version: 0,
  archived: false,
  role: 'owner',
  permissions: PERMISSIONS,
};
const projects = (overrides: Partial<ProjectRepository> = {}): ProjectRepository => ({
  list: async () => [project],
  get: async () => project,
  create: async () => project,
  update: async () => project,
  deleteArchived: async () => undefined,
  workflows: async () => [],
  startWorkflow: async () => ({ id: 'workflow', name: '', projectId: project.id, phase: { kind: 'finished' } }),
  ...overrides,
});
const settled = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe('user management', () => {
  it('saves metadata before resetting the password', async () => {
    const calls: string[] = [];
    const management = createUserManagement(
      users({
        update: async () => {
          calls.push('metadata');
          return saved;
        },
        setPassword: async () => {
          calls.push('password');
        },
      }),
    );
    expect(await management.edit(user, { name: 'Saved' }, 'new-password', { canManage: true })).toEqual({
      kind: 'saved',
      user: saved,
    });
    expect(calls).toEqual(['metadata', 'password']);
  });
  it('preserves saved metadata when password reset fails', async () => {
    const management = createUserManagement(
      users({
        setPassword: async () => {
          throw new RequestError('forbidden', 'denied');
        },
      }),
    );
    expect(await management.edit(user, { name: 'Saved' }, 'new-password', { canManage: true })).toEqual({
      kind: 'passwordFailed',
      user: saved,
      error: 'forbidden',
    });
  });
  it('never resets the password after metadata fails', async () => {
    let passwordChanged = false;
    const management = createUserManagement(
      users({
        update: async () => {
          throw new RequestError('versionConflict', 'stale');
        },
        setPassword: async () => {
          passwordChanged = true;
        },
      }),
    );
    expect(await management.edit(user, { name: 'Saved' }, 'new-password', { canManage: true })).toEqual({
      kind: 'failed',
      error: 'versionConflict',
    });
    expect(passwordChanged).toBe(false);
  });
  it('denies changes before touching the port', async () => {
    let changed = false;
    const management = createUserManagement(
      users({
        update: async () => {
          changed = true;
          return saved;
        },
      }),
    );
    expect(await management.edit(user, { name: 'Saved' }, '', { canManage: false })).toEqual({
      kind: 'failed',
      error: 'forbidden',
    });
    expect(changed).toBe(false);
  });
});

describe('project management', () => {
  it('ignores an older response after switching the loaded project', async () => {
    let finishFirst: ((project: Project) => void) | undefined;
    const query = createProjectManagement(
      projects({
        get: async (id) =>
          id === 'first'
            ? new Promise<Project>((resolve) => {
                finishFirst = resolve;
              })
            : { ...project, id },
      }),
    ).observeCurrent();
    query.load('first');
    query.load('second');
    await settled();
    finishFirst?.({ ...project, id: 'first' });
    await settled();
    expect(query.getSnapshot()).toMatchObject({ data: { id: 'second' } });
  });
  it('exposes failed project loads and allows retry', async () => {
    let fails = true;
    const query = createProjectManagement(
      projects({
        get: async () => {
          if (fails) throw new RequestError('notFound', 'missing');
          return project;
        },
      }),
    ).observeCurrent();
    query.load('project');
    await settled();
    expect(query.getSnapshot()).toMatchObject({ status: 'failed', error: 'notFound' });
    fails = false;
    query.reload();
    await settled();
    expect(query.getSnapshot()).toMatchObject({ status: 'ready', data: project });
  });
  it('denies editing and starting archived workflows', async () => {
    const management = createProjectManagement(projects());
    await expect(management.update({ ...project, permissions: [] }, { name: 'Denied' })).rejects.toMatchObject({
      kind: 'forbidden',
    });
    await expect(management.startWorkflow({ ...project, archived: true })).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('flushes before switching and respects changes during flush', async () => {
    let switched = false;
    let allowed = true;
    const open = createWorkflowSwitch({
      currentWorkflowId: () => 'current',
      flush: async () => {
        allowed = false;
        return true;
      },
      canSwitch: () => allowed,
      switchWorkflow: () => {
        switched = true;
      },
    });
    await expect(open('target')).rejects.toMatchObject({ kind: 'conflict' });
    expect(switched).toBe(false);
  });
});

describe('member management', () => {
  it('exposes member load failure and retries', async () => {
    let fails = true;
    const query = createMemberManagement(
      users({
        members: async () => {
          if (fails) throw new RequestError('forbidden', 'denied');
          return [{ user, role: 'owner' }];
        },
      }),
    ).observeCurrent();
    query.load('project');
    await settled();
    expect(query.getSnapshot()).toMatchObject({ status: 'failed', error: 'forbidden' });
    fails = false;
    query.reload();
    await settled();
    expect(query.getSnapshot()).toMatchObject({ data: [{ user, role: 'owner' }] });
  });
  it('denies member mutations without manager access', async () => {
    let changed = false;
    const management = createMemberManagement(
      users({
        removeMember: async () => {
          changed = true;
        },
      }),
    );
    await expect(management.remove({ projectId: 'project', canManage: false }, user.id)).rejects.toMatchObject({
      kind: 'forbidden',
    });
    expect(changed).toBe(false);
  });
});

describe('work management', () => {
  it('retains work after a refresh failure and retries explicitly', async () => {
    let fails = false;
    const query = createWorkManagement({
      mine: async () => {
        if (fails) throw new Error('offline');
        return [];
      },
    }).observe();
    query.load(undefined);
    await settled();
    fails = true;
    query.reload();
    await settled();
    expect(query.getSnapshot()).toEqual({ status: 'failed', data: [], error: 'unknown' });
    fails = false;
    query.reload();
    await settled();
    expect(query.getSnapshot()).toEqual({ status: 'ready', data: [] });
  });
});

it('does not switch after its lifecycle stops during the flush', async () => {
  const scope = createProjectLifecycle();
  scope.start();
  let finish: ((saved: boolean) => void) | undefined;
  let switched = false;
  const open = createWorkflowSwitch({
    scope,
    currentWorkflowId: () => 'current',
    flush: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
    switchWorkflow: () => {
      switched = true;
    },
  });
  const opening = open('target');
  scope.stop();
  finish?.(true);
  await expect(opening).rejects.toMatchObject({ kind: 'conflict' });
  expect(switched).toBe(false);
});

it('exposes synchronous port exceptions as retryable failed query state', async () => {
  const query = createManagementQuery<boolean, readonly Project[]>((): Promise<readonly Project[]> => {
    throw new RequestError('forbidden', 'denied');
  });
  expect(() => query.load(false)).not.toThrow();
  await settled();
  expect(query.getSnapshot()).toEqual({ status: 'failed', error: 'forbidden' });
});

it('rejects a switch when flushing could not save the current workspace', async () => {
  const open = createWorkflowSwitch({
    currentWorkflowId: () => 'current',
    flush: async () => false,
    switchWorkflow: () => {
      throw new Error('Must not switch');
    },
  });
  await expect(open('target')).rejects.toMatchObject({ kind: 'conflict' });
});
