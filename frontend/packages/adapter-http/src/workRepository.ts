import {
  WORK_GROUPS,
  WORK_KINDS,
  type WorkGroup,
  type WorkItem,
  type WorkKind,
  type WorkWait,
} from '@process-flow/domain';
import { RequestError, type WorkRepository } from '@process-flow/application';
import { createJsonCall } from './jsonClient';

function decodeWait(value: unknown): WorkWait | undefined {
  const { kind, remaining } = (value ?? {}) as Record<string, unknown>;
  if (kind === 'stageLocked') return { kind };
  if (kind === 'afterTasks' && Number.isInteger(remaining)) return { kind, remaining: remaining as number };
  return undefined;
}

function decodeItem(value: unknown): WorkItem[] {
  const dto = (value ?? {}) as Record<string, unknown>;
  const { projectId, projectName, workflowId, workflowName, group, kind, stageId, stageIndex, taskId, taskNumber } =
    dto;
  const text = [projectId, projectName, workflowId, workflowName, stageId];
  if (
    text.some((item) => typeof item !== 'string') ||
    !WORK_GROUPS.includes(group as WorkGroup) ||
    !WORK_KINDS.includes(kind as WorkKind) ||
    !Number.isInteger(stageIndex) ||
    (kind === 'task' && (typeof taskId !== 'string' || !Number.isInteger(taskNumber)))
  ) {
    return [];
  }
  const wait = decodeWait(dto.wait);
  return [
    {
      projectId: projectId as string,
      projectName: projectName as string,
      workflowId: workflowId as string,
      workflowName: workflowName as string,
      group: group as WorkGroup,
      kind: kind as WorkKind,
      stageId: stageId as string,
      stageIndex: stageIndex as number,
      ...(kind === 'task' ? { taskId: taskId as string, taskNumber: taskNumber as number } : {}),
      ...(wait ? { wait } : {}),
      rework: dto.rework === true,
    },
  ];
}

export function createWorkRepository(request: typeof fetch = fetch, base = '/api/v1'): WorkRepository {
  const call = createJsonCall(request, base);
  return {
    async mine() {
      const { items } = ((await call('/me/work')) ?? {}) as { items?: unknown };
      if (!Array.isArray(items)) throw new RequestError('unknown', 'Invalid work response');
      return items.flatMap(decodeItem);
    },
  };
}
