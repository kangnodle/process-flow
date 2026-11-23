import {
  Badge,
  Body1Strong,
  Caption1,
  Spinner,
  Subtitle2,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { useState } from 'react';
import { errorKindOf, type RequestErrorKind } from '@process-flow/application';
import { ChevronRight16Regular } from '@fluentui/react-icons';
import { type Process, WORK_GROUPS, type WorkGroup, type WorkItem } from '@process-flow/domain';
import { type MyWorkState, useProjects, useWorkflow } from '@process-flow/react';
import { useI18n, type I18n } from '../i18n/useI18n';
import { InlineError } from './InlineError';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  note: { color: tokens.colorNeutralForeground3 },
  group: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  list: { listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  item: { borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  button: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    width: '100%',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalXS}`,
    border: 'none',
    backgroundColor: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':focus-visible': { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  text: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS, minWidth: 0, flexGrow: 1 },
  title: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
});

function itemLabel(item: WorkItem, { t, st, tt }: I18n, process: Process): string {
  const stage = process.stages[item.stageIndex];
  const stageName = stage ? st(stage).name : item.stageId;
  if (item.kind === 'approval') return t.workApproval(item.stageIndex + 1, stageName);
  if (item.kind === 'consulted' || item.kind === 'informed') {
    return t.workWatch(item.kind, item.stageIndex + 1, stageName);
  }
  const task = process.tasks.find((candidate) => candidate.id === item.taskId);
  return t.workTask(item.taskNumber ?? 0, task ? tt(task).name : (item.taskId ?? ''));
}

function waitText(item: WorkItem, t: I18n['t']): string | null {
  if (!item.wait) return null;
  if (item.wait.kind === 'stageLocked') return t.workWaitLocked(item.stageIndex + 1);
  return item.kind === 'approval' ? t.workWaitStageTasks(item.wait.remaining) : t.workWaitTasks(item.wait.remaining);
}

interface MyWorkProps {
  readonly work: MyWorkState;
  readonly onNavigate?: () => void;
  readonly className?: string;
}

export function MyWork({ work, onNavigate, className }: MyWorkProps) {
  const styles = useStyles();
  const i18n = useI18n();
  const { t } = i18n;
  const { process, dispatch } = useWorkflow();
  const projects = useProjects();
  const { items, failed } = work;
  const [openError, setOpenError] = useState<RequestErrorKind>();

  const go = async (item: WorkItem) => {
    const task = process.tasks.find((candidate) => candidate.id === item.taskId);
    const target = task ?? process.stages[item.stageIndex]?.tasks[0];
    if (!target) return;
    const view = item.kind === 'task' ? ('task' as const) : ('stage' as const);
    setOpenError(undefined);
    try {
      if (item.workflowId === projects?.currentWorkflowId) dispatch({ type: 'selectTask', taskId: target.id, view });
      else await projects?.openWorkflow(item.workflowId, { taskId: target.id, view });
      onNavigate?.();
    } catch (reason) {
      setOpenError(errorKindOf(reason));
    }
  };

  if (!items) {
    return failed ? (
      <InlineError message={t.workLoadFailed} onRetry={work.reload} />
    ) : (
      <Spinner size="small" label={t.loading} />
    );
  }
  const byGroup = (group: WorkGroup) => items.filter((item) => item.group === group);
  return (
    <div className={mergeClasses(styles.root, className)}>
      {openError && (
        <InlineError message={openError === 'conflict' ? t.unsavedBlocksSwitch : t.projectError[openError]} />
      )}
      {failed && <InlineError message={t.workLoadFailed} onRetry={work.reload} />}
      {items.length === 0 && <Caption1 className={styles.note}>{t.workNothing}</Caption1>}
      {items.length > 0 && byGroup('ready').length === 0 && (
        <Caption1 className={styles.note}>{t.workNothingReady}</Caption1>
      )}
      {WORK_GROUPS.map((group) => {
        const list = byGroup(group);
        if (list.length === 0) return null;
        return (
          <section key={group} className={styles.group} aria-labelledby={`work-group-${group}`}>
            <Subtitle2 as="h3" id={`work-group-${group}`}>
              {t.workGroup[group]}
            </Subtitle2>
            <Caption1 className={styles.note}>{t.workGroupHint[group]}</Caption1>
            <ul className={styles.list} aria-label={t.workGroup[group]}>
              {list.map((item) => {
                const label = itemLabel(item, i18n, process);
                const where = t.workWhere(item.projectName, item.workflowName);
                const wait = waitText(item, t);
                return (
                  <li key={`${item.workflowId}:${item.kind}:${item.taskId ?? item.stageId}`} className={styles.item}>
                    <button
                      type="button"
                      className={styles.button}
                      aria-label={t.openWorkItem(`${label}, ${where}`)}
                      onClick={() => void go(item)}
                    >
                      <span className={styles.text}>
                        <span className={styles.title}>
                          <Body1Strong>{label}</Body1Strong>
                          {item.rework && (
                            <Badge appearance="tint" color="warning">
                              {t.workRework}
                            </Badge>
                          )}
                        </span>
                        <Caption1 className={styles.note}>{where}</Caption1>
                        {wait && <Caption1 className={styles.note}>{wait}</Caption1>}
                      </span>
                      <ChevronRight16Regular aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
