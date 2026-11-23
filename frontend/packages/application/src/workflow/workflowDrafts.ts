import {
  authorityOf,
  getRecord,
  isDone,
  isTaskLocked,
  type PersistentAction,
  type Process,
  type TaskId,
  type TaskRecord,
  type WorkflowAction,
  type WorkflowAuthority,
  type WorkflowState,
} from '@process-flow/domain';

export function collectWorkflowDrafts(
  state: WorkflowState,
  queue: readonly PersistentAction[],
): Readonly<Record<TaskId, TaskRecord>> {
  const drafts: Record<TaskId, TaskRecord> = {};
  for (const action of queue) {
    if (action.type === 'updateRecord') drafts[action.taskId] = getRecord(state, action.taskId);
  }
  return drafts;
}

export function restoreDraftAction(
  process: Process,
  state: WorkflowState,
  authority: WorkflowAuthority | undefined,
  taskId: TaskId,
  draft: TaskRecord,
): WorkflowAction | undefined {
  if (isDone(process, state, taskId) || isTaskLocked(process, state, taskId)) return;
  const action: WorkflowAction = {
    type: 'updateRecord',
    taskId,
    patch: {
      ...draft,
      evidence: draft.evidence ?? [],
      document: { ...(draft.document ?? { version: 1, answers: {} }), reviewStatus: 'pending' },
    },
  };
  return authorityOf(process, authority, action) === null ? undefined : action;
}

export function acknowledgeWorkflowDraft(
  drafts: Readonly<Record<TaskId, TaskRecord>>,
  state: WorkflowState,
  action: PersistentAction,
): Readonly<Record<TaskId, TaskRecord>> {
  if (action.type !== 'updateRecord') return drafts;
  const archived = drafts[action.taskId];
  if (!archived || draftContent(getRecord(state, action.taskId)) !== draftContent(archived)) return drafts;
  const remaining = { ...drafts };
  delete remaining[action.taskId];
  return remaining;
}

function draftContent(record: TaskRecord): string {
  return JSON.stringify([
    record.link,
    record.note,
    record.document?.version ?? 1,
    Object.entries(record.document?.answers ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    (record.evidence ?? []).map((item) => [
      item.id,
      item.kind,
      item.title,
      item.description,
      item.url,
      item.fileName,
      item.mediaType,
      item.size,
      item.base64,
    ]),
  ]);
}
