import { Button, Card, Caption1, Subtitle2 } from '@fluentui/react-components';
import { getTask, isDone, isTaskLocked } from '@process-flow/domain';
import { memo } from 'react';
import { shallowEqual, useWorkflowSelector } from '@process-flow/react';
import { TaskDocumentResult } from './TaskDocument';
import { useI18n } from '../i18n/useI18n';

export const RecoveredDrafts = memo(function RecoveredDrafts({ disabled = false }: { disabled?: boolean }) {
  const { process, state, conflictedDrafts, restoreDraft, dispatch, blockOf, persistence } = useWorkflowSelector(
    ({ process, state, conflictedDrafts, restoreDraft, dispatch, blockOf, persistence }) => ({
      process,
      state,
      conflictedDrafts,
      restoreDraft,
      dispatch,
      blockOf,
      persistence,
    }),
    (a, b) => a.state.phase === b.state.phase && shallowEqual({ ...a, state: null }, { ...b, state: null }),
  );
  const { locale, tt } = useI18n();
  const ko = locale === 'ko';
  if (!conflictedDrafts || Object.keys(conflictedDrafts).length === 0) return null;
  return (
    <Card size="large" role="region" aria-label={ko ? '보관된 초안' : 'Recovered drafts'}>
      <Subtitle2 as="h3">{ko ? '보관된 초안' : 'Recovered drafts'}</Subtitle2>
      <Caption1>
        {ko
          ? '서버의 최신 내용은 아래 문서에 표시됩니다. 보관된 초안과 비교한 뒤 적용하세요. 완료·잠금 상태인 작업은 먼저 완료 취소 또는 재작업이 필요합니다.'
          : 'The document below shows the latest saved content. Compare it with your draft before restoring. Reopen or rework completed tasks first.'}
      </Caption1>
      {Object.entries(conflictedDrafts).map(([taskId, record]) => (
        <details key={taskId}>
          <summary>{tt(getTask(process, taskId)).name}</summary>
          <TaskDocumentResult taskId={taskId} record={record} />
          <Button onClick={() => dispatch({ type: 'selectTask', taskId, view: 'task' })}>
            {ko ? '작업 열기' : 'Open task'}
          </Button>
          <Button
            disabled={
              disabled ||
              !restoreDraft ||
              persistence === 'error' ||
              isDone(process, state, taskId) ||
              isTaskLocked(process, state, taskId) ||
              blockOf({ type: 'updateRecord', taskId, patch: record }) !== null
            }
            onClick={() => restoreDraft?.(taskId)}
          >
            {ko ? '보관된 초안 적용' : 'Restore recovered draft'}
          </Button>
        </details>
      ))}
    </Card>
  );
});
