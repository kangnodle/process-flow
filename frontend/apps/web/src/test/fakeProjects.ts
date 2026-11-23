import {
  accountableFor,
  type Assignments,
  type AssignmentsInput,
  type Authority,
  authorityOf,
  createInitialState,
  createWorkflowReducer,
  type Member,
  NO_ASSIGNMENTS,
  type Permission,
  PERMISSIONS,
  type Project,
  responsibleFor,
  type Role,
  STANDARD_PROCESS,
  type User,
  type WorkflowAuthority,
  type WorkflowState,
  type WorkItem,
} from '@process-flow/domain';
import {
  RequestError,
  type WorkRepository,
  type WorkspacePreferences,
  type ProjectRepository,
  type UserRepository,
  type SavedWorkflow,
  type WorkflowRepository,
} from '@process-flow/application';

interface StoredWorkflow {
  id: string;
  projectId: string;
  name: string;
  version: number;
  state: WorkflowState;
}

export function createFakeBackend({
  empty = false,
  role: initialRole = 'owner',
  me = 'me',
}: {
  readonly empty?: boolean;
  readonly role?: Role;
  readonly me?: string;
} = {}) {
  const reduce = createWorkflowReducer(STANDARD_PROCESS);
  let role = initialRole;
  const permissionsOf = (current: Role): readonly Permission[] =>
    current === 'owner'
      ? PERMISSIONS
      : current === 'editor'
        ? ['project.view', 'workflow.start', 'workflow.execute', 'preferences.save']
        : ['project.view'];
  const require = (permission: Permission) => {
    if (!permissionsOf(role).includes(permission)) throw new RequestError('forbidden', permission);
  };
  const assignments = new Map<string, Assignments>();
  const assignmentsOf = (workflowId: string) => assignments.get(workflowId) ?? NO_ASSIGNMENTS;
  const authorityMap = (workflowId: string, permissions: readonly Permission[]): WorkflowAuthority => {
    const current = assignmentsOf(workflowId);
    const decide = (assigned: readonly string[]): Authority | null => {
      if (!permissions.includes('workflow.execute')) return null;
      if (assigned.length === 0) return 'open';
      if (assigned.includes(me)) return 'assigned';
      return role === 'owner' ? 'override' : null;
    };
    return {
      tasks: Object.fromEntries(
        STANDARD_PROCESS.tasks.map((task) => [task.id, decide(responsibleFor(STANDARD_PROCESS, current, task.id))]),
      ),
      stages: Object.fromEntries(
        STANDARD_PROCESS.stages.map((stage) => {
          const accountable = accountableFor(current, stage.id);
          return [stage.id, decide(accountable ? [accountable] : [])];
        }),
      ),
    };
  };
  type StoredProject = Omit<Project, 'role' | 'permissions'>;
  const withAccess = (project: StoredProject): Project => ({ ...project, role, permissions: permissionsOf(role) });
  let nextId = 1;
  const projects: StoredProject[] = empty
    ? []
    : [{ id: 'first', name: '첫 프로젝트', description: '', archived: false, version: 0 }];
  const workflows: StoredWorkflow[] = empty
    ? []
    : [
        {
          id: 'wf-first',
          projectId: 'first',
          name: '첫 워크플로',
          version: 0,
          state: createInitialState(STANDARD_PROCESS),
        },
      ];
  let current: string | undefined = empty ? undefined : 'wf-first';
  const findProject = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (!project) throw new RequestError('notFound', id);
    return project;
  };
  const workflowPermissions = (workflow: StoredWorkflow) =>
    permissionsOf(findProject(workflow.projectId).archived ? 'viewer' : role);
  const saved = (workflow: StoredWorkflow): SavedWorkflow => {
    const permissions = workflowPermissions(workflow);
    return {
      id: workflow.id,
      name: workflow.name,
      projectId: workflow.projectId,
      projectArchived: findProject(workflow.projectId).archived,
      version: workflow.version,
      state: workflow.state,
      preferences: {},
      permissions,
      assignments: assignmentsOf(workflow.id),
      authority: authorityMap(workflow.id, permissions),
    };
  };
  const summary = (workflow: StoredWorkflow) => ({
    id: workflow.id,
    projectId: workflow.projectId,
    name: workflow.name,
    phase: workflow.state.phase,
  });

  const savedPreferences: WorkspacePreferences[] = [];
  let workItems: readonly WorkItem[] = [];
  let workFails = false;
  const workRepository: WorkRepository = {
    async mine() {
      if (workFails) throw new RequestError('unknown', 'down');
      return workItems;
    },
  };

  const workflowRepository: WorkflowRepository = {
    async open() {
      if (current === undefined) return undefined;
      const workflow = workflows.find((w) => w.id === current);
      if (!workflow) {
        current = undefined;
        return undefined;
      }
      return saved(workflow);
    },
    async execute(id, version, command) {
      const workflow = workflows.find((w) => w.id === id)!;
      const permissions = workflowPermissions(workflow);
      if (!permissions.includes('workflow.execute')) throw new RequestError('forbidden', 'workflow.execute');
      if (authorityOf(STANDARD_PROCESS, authorityMap(id, permissions), command) === null) {
        throw new RequestError('forbidden', 'assigned to someone else');
      }
      if (workflow.version !== version) throw new Error('HTTP 409');
      workflow.state = reduce(workflow.state, command);
      workflow.version += 1;
      return saved(workflow);
    },
    switchTo(id) {
      current = id;
    },
    async savePreferences(_id, patch) {
      savedPreferences.push(patch);
      return patch;
    },
    async saveAssignments(id, expectedVersion, input) {
      require('assignments.manage');
      const stored = assignmentsOf(id);
      if (stored.version !== expectedVersion) throw new RequestError('versionConflict', 'stale');
      const next = { version: stored.version + 1, ...input };
      assignments.set(id, next);
      return next;
    },
  };

  const projectRepository: ProjectRepository = {
    async list(includeArchived) {
      return projects.filter((p) => includeArchived || !p.archived).map(withAccess);
    },
    async get(id) {
      return withAccess(findProject(id));
    },
    async create({ name, description }) {
      if (!name.trim()) throw new RequestError('invalid', 'name');
      const project = {
        id: `p${nextId++}`,
        name: name.trim(),
        description: description?.trim() ?? '',
        archived: false,
        version: 0,
      };
      projects.push(project);
      return { ...project, role: 'owner', permissions: PERMISSIONS };
    },
    async deleteArchived(id, expectedVersion) {
      require('project.edit');
      const project = projects.find((p) => p.id === id);
      if (!project || !project.archived || project.version !== expectedVersion)
        throw new RequestError('conflict', 'stale');
      projects.splice(projects.indexOf(project), 1);
      for (let i = workflows.length - 1; i >= 0; i--) {
        if (workflows[i]!.projectId === id) workflows.splice(i, 1);
      }
    },
    async update(id, expectedVersion, patch) {
      require('project.edit');
      const index = projects.findIndex((p) => p.id === id);
      const project = findProject(id);
      if (project.version !== expectedVersion) throw new RequestError('versionConflict', 'stale');
      const updated = { ...project, ...patch, version: project.version + 1 };
      projects[index] = updated;
      return withAccess(updated);
    },
    async workflows(projectId) {
      findProject(projectId);
      return workflows
        .filter((w) => w.projectId === projectId)
        .reverse()
        .map(summary);
    },
    async startWorkflow(projectId, name) {
      require('workflow.start');
      if (findProject(projectId).archived) throw new RequestError('conflict', projectId);
      const workflow = {
        id: `wf${nextId++}`,
        projectId,
        name: name?.trim() || '새 워크플로',
        version: 0,
        state: createInitialState(STANDARD_PROCESS),
      };
      workflows.push(workflow);
      return summary(workflow);
    },
  };

  const users: User[] = [];
  const passwords = new Map<string, string>();
  const memberships: { projectId: string; userId: string; role: Member['role'] }[] = [];
  const findUser = (id: string) => {
    const user = users.find((u) => u.id === id);
    if (!user) throw new RequestError('notFound', id);
    return user;
  };
  const emailTaken = (email: string, except?: string) => users.some((u) => u.email === email && u.id !== except);
  const membersOf = (projectId: string) =>
    memberships.filter((m) => m.projectId === projectId).map((m) => ({ role: m.role, user: findUser(m.userId) }));
  const ensureOwnerRemains = (projectId: string, userId: string, next: Member['role'] | undefined) => {
    const list = memberships.filter((m) => m.projectId === projectId);
    const had = list.some((m) => m.role === 'owner');
    const after = list.some((m) => (m.userId === userId ? next === 'owner' : m.role === 'owner'));
    if (had && !after) throw new RequestError('conflict', 'last owner');
  };

  const userRepository: UserRepository = {
    async list(includeInactive) {
      return users.filter((u) => includeInactive || u.active);
    },
    async create({ email, name, password }) {
      if (emailTaken(email)) throw new RequestError('conflict', 'email');
      const user = { id: `u${nextId++}`, email, name, active: true, isAdmin: false, version: 0 };
      users.push(user);
      passwords.set(user.id, password);
      return user;
    },
    async update(id, expectedVersion, patch) {
      const user = findUser(id);
      if (user.version !== expectedVersion) throw new RequestError('versionConflict', 'stale');
      if (patch.email && emailTaken(patch.email, id)) throw new RequestError('conflict', 'email');
      const updated = { ...user, ...patch, version: user.version + 1 };
      const activeAdmin = (u: User) => u.active && u.isAdmin;
      if (users.some(activeAdmin) && !users.some((u) => activeAdmin(u.id === id ? updated : u))) {
        throw new RequestError('conflict', 'last admin');
      }
      users[users.indexOf(user)] = updated;
      return updated;
    },
    async setPassword(id, password) {
      passwords.set(findUser(id).id, password);
    },
    async members(projectId) {
      findProject(projectId);
      return membersOf(projectId);
    },
    async putMember(projectId, userId, role) {
      require('members.manage');
      findProject(projectId);
      const user = findUser(userId);
      const existing = memberships.find((m) => m.projectId === projectId && m.userId === userId);
      if (!existing && !user.active) throw new RequestError('conflict', 'inactive');
      ensureOwnerRemains(projectId, userId, role);
      if (existing) existing.role = role;
      else memberships.push({ projectId, userId, role });
      return { role, user };
    },
    async removeMember(projectId, userId) {
      require('members.manage');
      if (!memberships.some((m) => m.projectId === projectId && m.userId === userId)) {
        throw new RequestError('notFound', userId);
      }
      ensureOwnerRemains(projectId, userId, undefined);
      memberships.splice(
        memberships.findIndex((m) => m.projectId === projectId && m.userId === userId),
        1,
      );
    },
  };

  return {
    workflowRepository,
    projectRepository,
    userRepository,
    workRepository,
    setWork(items: readonly WorkItem[]) {
      workItems = items;
    },
    failWork(fails: boolean) {
      workFails = fails;
    },
    savedPreferences: () => savedPreferences,
    currentWorkflowId: () => current,
    forgetCurrent() {
      const index = workflows.findIndex((w) => w.id === current);
      if (index >= 0) workflows.splice(index, 1);
    },
    workflowCount: () => workflows.length,
    versionOf: (workflowId: string) => workflows.find((w) => w.id === workflowId)?.version ?? 0,
    assign(workflowId: string, input: AssignmentsInput) {
      assignments.set(workflowId, { version: assignmentsOf(workflowId).version + 1, ...input });
    },
    assignmentsOf,
    setRole(next: Role) {
      role = next;
    },
    passwordOf: (email: string) => passwords.get(users.find((u) => u.email === email)?.id ?? ''),
    bump(projectId: string, name: string) {
      const index = projects.findIndex((p) => p.id === projectId);
      projects[index] = { ...projects[index]!, name, version: projects[index]!.version + 1 };
    },
  };
}
