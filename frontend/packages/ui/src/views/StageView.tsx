import {
  Body1Strong,
  Button,
  Card,
  Caption1,
  Caption1Strong,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  ProgressBar,
  Subtitle1,
  Subtitle2,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import { CheckmarkCircle16Filled, ChevronRight16Regular, Circle16Regular } from '@fluentui/react-icons';
import {
  buildStageViewModel,
  selectStageAction,
  type StageMessage,
  type StagePrimary,
  type StageViewModel,
} from '@process-flow/application';
import {
  accountableFor,
  getRecord,
  taskForm,
  validateTaskDocument,
  NO_ASSIGNMENTS,
  responsibleFor,
} from '@process-flow/domain';
import { useWorkflow } from '@process-flow/react';
import { DisabledReason } from '../components/DisabledReason';
import { StageStepper } from '../components/StageStepper';
import { TaskDocumentResult } from '../components/TaskDocument';
import { DOCUMENT_MESSAGES } from '../i18n/documentMessages';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import { actionBlockText, namesOf } from '../i18n/actionBlockText';
import { useI18n, type I18n } from '../i18n/useI18n';
import { useMemberNames } from '../i18n/useMemberNames';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  row: { display: 'flex', flexWrap: 'wrap', gap: tokens.spacingHorizontalL, alignItems: 'flex-start' },
  main: { flex: '999 1 560px', minWidth: 0 },
  aside: { flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  heading: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS },
  eyebrow: { color: tokens.colorBrandForeground1 },
  muted: { color: tokens.colorNeutralForeground2 },
  progressHead: { display: 'flex', justifyContent: 'space-between', color: tokens.colorNeutralForeground2 },
  list: {
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    minHeight: '56px',
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  checkbox: { flexGrow: 1, minWidth: 0 },
  taskLabel: { display: 'flex', flexDirection: 'column' },
  number: { color: tokens.colorNeutralForeground3, fontVariantNumeric: 'tabular-nums' },
  footer: { display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: tokens.spacingHorizontalS },
  outputs: {
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  output: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  outputDone: { color: tokens.colorNeutralForeground1 },
  outputPending: { color: tokens.colorNeutralForeground3 },
  iconDone: { flexShrink: 0, color: tokens.colorBrandForeground1 },
  iconPending: { flexShrink: 0 },
});

function primaryText(
  primary: StagePrimary,
  vm: StageViewModel,
  t: I18n['t'],
): { label: string; reason: string | null } {
  switch (primary.kind) {
    case 'restartCycle':
      return { label: t.restartCycle, reason: primary.blocked ? t.remainingToFinish(vm.remaining) : null };
    case 'goNextStage':
      return { label: t.goNextStage, reason: primary.blocked ? t.nextStageStillLocked : null };
    case 'approveStage':
      return { label: t.approveStage, reason: primary.blocked ? t.remainingToApprove(vm.remaining) : null };
  }
}

function messageText(message: StageMessage, { t, st }: I18n): { title: string; body: string; ready: boolean } {
  switch (message.kind) {
    case 'processComplete':
      return { title: t.processComplete, body: t.startNextCycle, ready: true };
    case 'awaitingApproval':
      return { title: t.awaitingApprovalTitle, body: t.awaitingApprovalBody(st(message.nextStage).name), ready: true };
    case 'remainingToFinish':
      return { title: t.nextStageLocked, body: t.remainingToFinish(message.remaining), ready: false };
    case 'remainingToApprove':
      return { title: t.nextStageLocked, body: t.remainingToApprove(message.remaining), ready: false };
  }
}

export function StageView() {
  const styles = useStyles();
  const {
    process,
    state,
    dispatch,
    blockOf,
    persistence,
    hasUnsavedChanges,
    assignments = NO_ASSIGNMENTS,
  } = useWorkflow();
  const nameOf = useMemberNames();
  const i18n = useI18n();
  const { t, st, tt, locale } = i18n;
  const m = DOCUMENT_MESSAGES[locale];
  const vm = buildStageViewModel(process, state);
  const { stage, progress, nextStage } = vm;
  const primaryRule = primaryText(vm.primary, vm, t);
  if (vm.primary.action.type === 'approveStage' && !primaryRule.reason) {
    if (stage.tasks.some((task) => validateTaskDocument(task.id, getRecord(state, task.id)).length))
      primaryRule.reason = m.stageInvalid;
    else if (persistence === 'error' || hasUnsavedChanges) primaryRule.reason = m.saveFirst;
  }
  const primaryBlock = blockOf(vm.primary.action);
  const primary = primaryBlock ? { ...primaryRule, reason: actionBlockText(primaryBlock, t, nameOf) } : primaryRule;
  const accountable = accountableFor(assignments, stage.id);
  const message = vm.message ? messageText(vm.message, i18n) : null;

  return (
    <div className={styles.root}>
      <StageStepper viewingStage={stage.index} onSelectStage={(index) => dispatch(selectStageAction(process, index))} />

      <div className={styles.row}>
        <Card size="large" role="region" aria-labelledby="stage-title" className={styles.main}>
          <div className={styles.heading}>
            <Caption1Strong className={styles.eyebrow}>
              {t.stageEyebrow(
                stage.index + 1,
                vm.stageCount,
                vm.passed ? t.stageCompleted : vm.awaitingApproval ? t.statusAwaitingApproval : t.stageInProgress,
              )}
            </Caption1Strong>
            <Subtitle1 as="h2" id="stage-title">
              {st(stage).name}
            </Subtitle1>
            <Text className={styles.muted}>{st(stage).description}</Text>
            {accountable && <Caption1>{t.accountableLabel(nameOf(accountable) ?? t.unknownUser)}</Caption1>}
          </div>

          <div>
            <div className={styles.progressHead}>
              <Caption1>{t.stageProgress}</Caption1>
              <Caption1>{t.stageProgressValue(progress.done, progress.total)}</Caption1>
            </div>
            <ProgressBar value={progress.ratio} thickness="large" aria-label={t.stageProgress} />
          </div>

          {message && (
            <MessageBar intent={message.ready ? 'success' : 'info'}>
              <MessageBarBody>
                <MessageBarTitle>{message.title}</MessageBarTitle>
                {message.body}
              </MessageBarBody>
            </MessageBar>
          )}

          <ul className={styles.list} aria-label={t.stageTaskList(st(stage).name)}>
            {vm.tasks.map(({ task, done, status, rework }) => {
              const responsible = responsibleFor(process, assignments, task.id);
              return (
                <li key={task.id} className={styles.item}>
                  <div className={styles.checkbox}>
                    <span className={styles.taskLabel}>
                      <span>
                        <span className={styles.number}>{task.number}.</span> {tt(task).name}
                      </span>
                      <Caption1 className={styles.number}>{t.outputOf(tt(task).output)}</Caption1>
                      {responsible.length > 0 && (
                        <Caption1>{t.responsibleLabel(namesOf(responsible, nameOf, t))}</Caption1>
                      )}
                      <Caption1>
                        {done && validateTaskDocument(task.id, getRecord(state, task.id)).length > 0
                          ? m.legacy
                          : m.count(
                              taskForm(task.id).filter(
                                (f) => !validateTaskDocument(task.id, getRecord(state, task.id)).includes(f.id),
                              ).length,
                              taskForm(task.id).length,
                            )}
                      </Caption1>
                    </span>
                  </div>
                  <TaskStatusBadge status={status} rework={rework} />
                  <Button
                    appearance="transparent"
                    icon={<ChevronRight16Regular />}
                    iconPosition="after"
                    aria-label={t.openTaskInTaskView(tt(task).name)}
                    onClick={() => dispatch({ type: 'selectTask', taskId: task.id, view: 'task' })}
                  >
                    {t.open}
                  </Button>
                </li>
              );
            })}
          </ul>

          {vm.awaitingApproval && (
            <section aria-label={m.reviewStage}>
              <Subtitle2 as="h3">{m.reviewStage}</Subtitle2>
              <Text>{m.reviewStageHint}</Text>
              {stage.tasks.map((task) => (
                <details key={task.id}>
                  <summary>{tt(task).name}</summary>
                  <TaskDocumentResult taskId={task.id} />
                </details>
              ))}
            </section>
          )}
          <div className={styles.footer}>
            <Button disabled={!vm.previous} onClick={() => vm.previous && dispatch(vm.previous)}>
              {t.prevStage}
            </Button>
            <DisabledReason reason={primary.reason}>
              <Button
                appearance="primary"
                disabledFocusable={primary.reason !== null}
                onClick={() => dispatch(vm.primary.action)}
              >
                {primary.label}
              </Button>
            </DisabledReason>
          </div>
        </Card>

        <aside aria-label={t.stageSummary} className={styles.aside}>
          <Card role="region" aria-labelledby="stage-outputs-title">
            <Subtitle2 as="h3" id="stage-outputs-title">
              {t.stageOutputs}
            </Subtitle2>
            <ul className={styles.outputs}>
              {vm.tasks.map(({ task, done }) => (
                <li
                  key={task.id}
                  className={mergeClasses(styles.output, done ? styles.outputDone : styles.outputPending)}
                >
                  {done ? (
                    <CheckmarkCircle16Filled className={styles.iconDone} aria-label={t.statusDone} />
                  ) : (
                    <Circle16Regular className={styles.iconPending} />
                  )}
                  {tt(task).output}
                </li>
              ))}
            </ul>
          </Card>
          <Card role="region" aria-labelledby="stage-next-title">
            <Subtitle2 as="h3" id="stage-next-title">
              {t.nextStage}
            </Subtitle2>
            {nextStage ? (
              <>
                <Body1Strong>{t.stageWithName(nextStage.index + 1, st(nextStage).name)}</Body1Strong>
                <Text className={styles.muted}>{st(nextStage).description}</Text>
              </>
            ) : (
              <Text className={styles.muted}>{t.lastStageNote}</Text>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
