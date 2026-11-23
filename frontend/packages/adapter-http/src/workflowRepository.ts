import {
  type Assignments,
  type Authority,
  completedCount,
  createInitialState,
  isAuthority,
  isLocale,
  isPermission,
  isThemePreference,
  isValidPhase,
  isViewMode,
  type Phase,
  type Rework,
  STANDARD_PROCESS,
  type TaskRecord,
  type WorkflowAuthority,
} from '@process-flow/domain';
import {
  RequestError,
  errorKindOf,
  type SavedWorkflow,
  type WorkflowRepository,
  type WorkspacePreferences,
} from '@process-flow/application';
import { createJsonCall } from './jsonClient';
import { decodeTaskRecords } from './taskRecords';

export interface WorkflowIdentity {
  load(): string | undefined;
  save(id: string): void;
  clear?(): void;
}
interface WorkflowDto {
  id: string;
  name?: unknown;
  projectId?: unknown;
  projectArchived?: unknown;
  processId: string;
  version: number;
  phase: unknown;
  rework?: unknown;
  records: Record<string, TaskRecord>;
  permissions?: unknown;
  assignments?: unknown;
  authority?: unknown;
}
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
export function decodeAssignments(value: unknown): Assignments | undefined {
  const { version, stages, tasks } = (value ?? {}) as Record<string, unknown>;
  if (!Number.isInteger(version) || !Array.isArray(stages) || !Array.isArray(tasks)) return undefined;
  return {
    version: version as number,
    stages: stages.flatMap((item) => {
      const { stageId, accountable, responsible, consulted, informed } = (item ?? {}) as Record<string, unknown>;
      if (typeof stageId !== 'string') return [];
      return [
        {
          stageId,
          ...(typeof accountable === 'string' && accountable ? { accountable } : {}),
          responsible: strings(responsible),
          consulted: strings(consulted),
          informed: strings(informed),
        },
      ];
    }),
    tasks: tasks.flatMap((item) => {
      const { taskId, responsible } = (item ?? {}) as Record<string, unknown>;
      return typeof taskId === 'string' ? [{ taskId, responsible: strings(responsible) }] : [];
    }),
  };
}
function decodeAuthority(value: unknown): WorkflowAuthority | undefined {
  const { tasks, stages } = (value ?? {}) as Record<string, unknown>;
  if (typeof tasks !== 'object' || tasks === null || typeof stages !== 'object' || stages === null) return undefined;
  const read = (map: object): Record<string, Authority | null> =>
    Object.fromEntries(Object.entries(map).map(([key, item]) => [key, isAuthority(item) ? item : null]));
  return { tasks: read(tasks), stages: read(stages) };
}
function decodeRework(value: unknown, phase: Phase): Rework | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return undefined;
  const { untilNumber, reason } = value as Record<string, unknown>;
  const valid =
    Number.isInteger(untilNumber) &&
    (untilNumber as number) > completedCount(STANDARD_PROCESS, phase) &&
    (untilNumber as number) <= STANDARD_PROCESS.tasks.length &&
    typeof reason === 'string' &&
    reason.trim() !== '';
  return valid ? { untilNumber: untilNumber as number, reason: reason as string } : undefined;
}
function decode(dto: WorkflowDto): SavedWorkflow {
  if (
    dto.processId !== 'standard' ||
    !dto.id ||
    !Number.isInteger(dto.version) ||
    !isValidPhase(STANDARD_PROCESS, dto.phase)
  ) {
    throw new Error('Invalid workflow response');
  }
  const rework = decodeRework(dto.rework, dto.phase);
  if (rework === undefined) throw new Error('Invalid workflow response');
  const assignments = decodeAssignments(dto.assignments);
  const authority = decodeAuthority(dto.authority);
  return {
    id: dto.id,
    ...(typeof dto.name === 'string' ? { name: dto.name } : {}),
    ...(typeof dto.projectId === 'string' ? { projectId: dto.projectId } : {}),
    ...(typeof dto.projectArchived === 'boolean' ? { projectArchived: dto.projectArchived } : {}),
    version: dto.version,
    ...(Array.isArray(dto.permissions) ? { permissions: dto.permissions.filter(isPermission) } : {}),
    ...(assignments ? { assignments } : {}),
    ...(authority ? { authority } : {}),
    state: {
      ...createInitialState(STANDARD_PROCESS),
      phase: dto.phase,
      rework,
      records: decodeTaskRecords(dto.records),
    },
  };
}
interface PreferencesDto {
  locale?: unknown;
  theme?: unknown;
  view?: unknown;
  selectedTaskId?: unknown;
}
function decodePreferences(dto: PreferencesDto): WorkspacePreferences {
  const { locale, theme, view, selectedTaskId } = dto;
  return {
    ...(isLocale(locale) ? { locale } : {}),
    ...(isThemePreference(theme) ? { theme } : {}),
    ...(isViewMode(view) ? { view } : {}),
    ...(typeof selectedTaskId === 'string' && STANDARD_PROCESS.tasks.some((task) => task.id === selectedTaskId)
      ? { selectedTaskId }
      : {}),
  };
}
export function createWorkflowRepository(
  identity: WorkflowIdentity,
  request: typeof fetch = fetch,
  base = '/api/v1',
  sessionGeneration: () => number = () => 0,
): WorkflowRepository {
  const call = createJsonCall(request, base);
  const json = (path: string, body?: unknown, method = 'POST'): Promise<unknown> =>
    call(path, body === undefined ? 'GET' : method, body);
  let id = identity.load();
  let opening: Promise<SavedWorkflow | undefined> | undefined;
  let generation = 0;
  let session = sessionGeneration();
  function synchronizeSession() {
    const current = sessionGeneration();
    if (session === current) return;
    session = current;
    generation += 1;
    opening = undefined;
    id = identity.load();
  }
  return {
    open() {
      synchronizeSession();
      if (!id) return Promise.resolve(undefined);
      const target = id;
      if (opening) return opening;
      const requestedGeneration = generation;
      const requestedSession = session;
      const isCurrent = () => generation === requestedGeneration && sessionGeneration() === requestedSession;
      const operation = (async () => {
        let dto: WorkflowDto;
        try {
          dto = (await json(`/workflows/${encodeURIComponent(target)}`)) as WorkflowDto;
        } catch (error) {
          if (error instanceof RequestError && error.kind === 'notFound') {
            if (isCurrent()) {
              id = undefined;
              identity.clear?.();
            }
            return undefined;
          }
          throw error;
        }
        if (!isCurrent()) return undefined;
        const saved = decode(dto);
        if (isCurrent()) {
          id = saved.id;
          identity.save(id);
        }
        let preferences: WorkspacePreferences = {};
        let preferencesLoadError: string | undefined;
        try {
          preferences = decodePreferences(
            (await json(`/workflows/${encodeURIComponent(saved.id)}/preferences`)) as PreferencesDto,
          );
        } catch (error) {
          preferencesLoadError = errorKindOf(error);
        }
        return isCurrent()
          ? { ...saved, preferences, ...(preferencesLoadError ? { preferencesLoadError } : {}) }
          : undefined;
      })();
      opening = operation;
      const clearOpening = () => {
        if (opening === operation) opening = undefined;
      };
      void operation.then(clearOpening, clearOpening);
      return operation;
    },
    async execute(workflowId, expectedVersion, command) {
      const response = (await json(`/workflows/${encodeURIComponent(workflowId)}/commands`, {
        expectedVersion,
        command,
      })) as { workflow: WorkflowDto };
      return decode(response.workflow);
    },
    switchTo(workflowId) {
      synchronizeSession();
      generation += 1;
      opening = undefined;
      id = workflowId;
      if (workflowId) identity.save(workflowId);
      else identity.clear?.();
    },
    async savePreferences(workflowId, patch) {
      const body = await json(`/workflows/${encodeURIComponent(workflowId)}/preferences`, patch, 'PATCH');
      return decodePreferences(body as PreferencesDto);
    },
    async saveAssignments(workflowId, expectedVersion, input) {
      const saved = decodeAssignments(
        await call(`/workflows/${encodeURIComponent(workflowId)}/assignments`, 'PUT', { expectedVersion, ...input }),
      );
      if (!saved) throw new RequestError('unknown', 'Invalid assignments response');
      return saved;
    },
  };
}
