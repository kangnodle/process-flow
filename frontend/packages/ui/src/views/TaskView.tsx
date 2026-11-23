import {
  Breadcrumb,
  BreadcrumbButton,
  BreadcrumbDivider,
  BreadcrumbItem,
  Button,
  Card,
  Caption1,
  Caption1Strong,
  CounterBadge,
  DrawerHeaderTitle,
  MessageBar,
  MessageBarBody,
  Title3,
  Subtitle2,
  Text,
  NavCategory,
  NavCategoryItem,
  NavDrawer,
  NavDrawerBody,
  NavDrawerHeader,
  NavSubItem,
  NavSubItemGroup,
  makeStyles,
  tokens,
  useRestoreFocusTarget,
  type NavItemValue,
  type OnNavItemSelectData,
} from '@fluentui/react-components';
import {
  ArrowCircleRight16Regular,
  ArrowCounterclockwise16Regular,
  Dismiss24Regular,
  PanelLeft20Regular,
  CheckmarkCircle16Filled,
  CheckmarkCircle20Filled,
  CheckmarkCircle20Regular,
  Circle16Regular,
  CircleHalfFill20Filled,
  CircleHalfFill20Regular,
  LockClosed16Regular,
  LockClosed20Filled,
  LockClosed20Regular,
  bundleIcon,
} from '@fluentui/react-icons';
import {
  accountableFor,
  getTask,
  NO_ASSIGNMENTS,
  progressKey,
  responsibleFor,
  validateTaskDocument,
  type Process,
  type TaskDef,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';
import { memo, useState, useSyncExternalStore } from 'react';
import {
  buildTaskNav,
  buildTaskViewModel,
  navSelectAction,
  type CompactTaskLayoutSource,
  type TaskHint,
  type TaskPrimaryLabel,
} from '@process-flow/application';
import { useWorkflow } from '@process-flow/react';
import { DisabledReason } from '../components/DisabledReason';
import { ReworkBanner } from '../components/ReworkBanner';
import { ReworkDialog } from '../components/ReworkDialog';
import { TaskDocument, TaskDocumentResult } from '../components/TaskDocument';
import { RecoveredDrafts } from '../components/RecoveredDrafts';
import { DOCUMENT_MESSAGES } from '../i18n/documentMessages';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import type { Messages } from '../i18n/messages';
import { taskBlockText } from '../i18n/taskBlockText';
import { actionBlockText, namesOf } from '../i18n/actionBlockText';
import { useI18n } from '../i18n/useI18n';
import { useMemberNames } from '../i18n/useMemberNames';

const useStyles = makeStyles({
  root: { display: 'flex', gap: tokens.spacingHorizontalL, alignItems: 'flex-start' },
  nav: { flex: '0 0 280px', minWidth: 0, height: 'auto', borderRadius: tokens.borderRadiusMedium },
  navHeader: { paddingBottom: tokens.spacingVerticalS },
  categoryLabel: {
    flexGrow: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalS,
  },
  subItemGroup: { marginInlineStart: '-8px', paddingInlineStart: '8px' },
  subItemLabel: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS },
  subItemLocked: {
    color: tokens.colorNeutralForegroundDisabled,
    cursor: 'not-allowed',
    ':hover': { backgroundColor: 'transparent', color: tokens.colorNeutralForegroundDisabled },
  },
  main: { flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  heading: { margin: 0 },
  titleRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM },
  muted: { color: tokens.colorNeutralForeground2 },
  subtle: { color: tokens.colorNeutralForeground3 },
  pair: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))',
    gap: tokens.spacingHorizontalL,
  },
  small: { gap: tokens.spacingVerticalXXS },
  actions: {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalS,
    '@media (max-height: 480px)': { position: 'static' },
  },
  path: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalS },
  navToggle: { alignSelf: 'flex-start' },
  iconDone: { color: tokens.colorBrandForeground1 },
  iconPending: { color: tokens.colorNeutralForeground3 },
  iconDoing: { color: tokens.colorBrandForeground1 },
  iconRework: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

const desktopTaskLayout: CompactTaskLayoutSource = {
  current: () => false,
  subscribe: () => () => undefined,
};

const stageValue = (index: number): NavItemValue => `stage-${index}`;

const StageDoneIcon = bundleIcon(CheckmarkCircle20Filled, CheckmarkCircle20Regular);
const StageActiveIcon = bundleIcon(CircleHalfFill20Filled, CircleHalfFill20Regular);
const StageLockedIcon = bundleIcon(LockClosed20Filled, LockClosed20Regular);

function labelText(label: TaskPrimaryLabel, t: Messages): string {
  switch (label.kind) {
    case 'markDone':
      return t.markDone;
    case 'completeAndNext':
      return t.completeAndNext;
    case 'completeForApproval':
      return t.completeForApproval;
    case 'restartCycle':
      return t.restartCycle;
    case 'approveStage':
      return t.approveAndOpenStage(label.stageIndex + 1);
    case 'viewNextTask':
      return t.viewNextTask;
  }
}

function hintText(hint: TaskHint, t: Messages, taskName: (task: TaskDef) => string): string {
  switch (hint.kind) {
    case 'approvalAfterThis':
      return t.approvalAfterThis(hint.stageIndex + 1);
    case 'awaitingApproval':
      return t.awaitingApprovalHint(hint.stageIndex + 1);
    default:
      return taskBlockText(hint, t, taskName);
  }
}

interface TaskNavProps {
  readonly process: Process;
  readonly state: WorkflowState;
  readonly dispatch: (action: WorkflowAction) => void;
  readonly compact: boolean;
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
}

const TaskNav = memo(
  function TaskNav({ process, state, dispatch, compact, open, setOpen }: TaskNavProps) {
    const styles = useStyles();
    const { t, st, tt } = useI18n();
    const task = getTask(process, state.selectedTaskId);
    const nav = buildTaskNav(process, state);

    const [openStages, setOpenStages] = useState<ReadonlySet<NavItemValue>>(
      () => new Set([stageValue(task.stageIndex)]),
    );
    const openCategories = [...new Set(openStages).add(stageValue(task.stageIndex))];
    const handleCategoryToggle = (_: unknown, data: OnNavItemSelectData) => {
      const category = data.categoryValue;
      if (category === undefined) return;
      setOpenStages((current) => {
        const nextOpen = new Set(current);
        if (nextOpen.has(category)) nextOpen.delete(category);
        else nextOpen.add(category);
        return nextOpen;
      });
    };
    const handleItemSelect = (_: unknown, data: OnNavItemSelectData) => {
      const action = navSelectAction(process, state, data.value);
      if (!action) return;
      dispatch(action);
      if (compact) setOpen(false);
    };

    return (
      <NavDrawer
        type={compact ? 'overlay' : 'inline'}
        role={compact ? 'dialog' : 'navigation'}
        open={!compact || open}
        onOpenChange={(_, data) => setOpen(data.open)}
        {...(!compact && { surfaceMotion: null, className: styles.nav })}
        aria-label={t.taskNavLabel}
        selectedValue={task.id}
        selectedCategoryValue={stageValue(task.stageIndex)}
        openCategories={openCategories}
        onNavItemSelect={handleItemSelect}
        onNavCategoryItemToggle={handleCategoryToggle}
      >
        <NavDrawerHeader className={styles.navHeader}>
          <DrawerHeaderTitle
            action={
              compact ? (
                <Button
                  appearance="subtle"
                  aria-label={t.close}
                  icon={<Dismiss24Regular />}
                  onClick={() => setOpen(false)}
                />
              ) : null
            }
          >
            {t.taskNavLabel}
          </DrawerHeaderTitle>
        </NavDrawerHeader>
        <NavDrawerBody>
          {nav.map(({ stage: s, locked: stageLocked, complete: stageComplete, progress, tasks }) => {
            const doneCount = progress.done;
            const StageIcon = stageLocked ? StageLockedIcon : stageComplete ? StageDoneIcon : StageActiveIcon;
            return (
              <NavCategory key={s.index} value={stageValue(s.index)}>
                <NavCategoryItem icon={<StageIcon aria-label={stageLocked ? t.statusLocked : undefined} />}>
                  <span className={styles.categoryLabel}>
                    <span>
                      {s.index + 1}. {st(s).name}
                    </span>
                    {!stageLocked && (
                      <CounterBadge
                        count={doneCount}
                        overflowCount={99}
                        showZero
                        size="small"
                        appearance={stageComplete ? 'filled' : 'ghost'}
                        color={stageComplete ? 'brand' : 'informative'}
                        aria-label={t.stageDoneCount(doneCount, s.tasks.length)}
                      />
                    )}
                  </span>
                </NavCategoryItem>
                <NavSubItemGroup className={styles.subItemGroup}>
                  {tasks.map(({ task: item, status: itemStatus, rework: itemRework }) => {
                    return (
                      <DisabledReason key={item.id} reason={stageLocked ? t.unlocksAfter(s.index) : null}>
                        <NavSubItem
                          value={item.id}
                          disabledFocusable={stageLocked}
                          className={stageLocked ? styles.subItemLocked : undefined}
                        >
                          <span className={styles.subItemLabel}>
                            {stageLocked ? (
                              <LockClosed16Regular />
                            ) : itemStatus === 'done' ? (
                              <CheckmarkCircle16Filled className={styles.iconDone} aria-label={t.statusDone} />
                            ) : itemRework ? (
                              <ArrowCounterclockwise16Regular
                                className={styles.iconRework}
                                aria-label={itemStatus === 'doing' ? t.statusRedoing : t.statusRedoTodo}
                              />
                            ) : itemStatus === 'doing' ? (
                              <ArrowCircleRight16Regular className={styles.iconDoing} aria-label={t.statusDoing} />
                            ) : (
                              <Circle16Regular className={styles.iconPending} />
                            )}
                            <span>
                              {item.number}. {tt(item).name}
                            </span>
                          </span>
                        </NavSubItem>
                      </DisabledReason>
                    );
                  })}
                </NavSubItemGroup>
              </NavCategory>
            );
          })}
        </NavDrawerBody>
      </NavDrawer>
    );
  },
  (previous, next) =>
    previous.process === next.process &&
    previous.dispatch === next.dispatch &&
    previous.compact === next.compact &&
    previous.open === next.open &&
    previous.setOpen === next.setOpen &&
    previous.state.selectedTaskId === next.state.selectedTaskId &&
    progressKey(previous.state) === progressKey(next.state),
);

export function TaskView({
  compactTaskLayout = desktopTaskLayout,
}: {
  readonly compactTaskLayout: CompactTaskLayoutSource | undefined;
}) {
  const {
    process,
    state,
    dispatch,
    blockOf,
    flush,
    persistence,
    hasUnsavedChanges,
    assignments = NO_ASSIGNMENTS,
  } = useWorkflow();
  const styles = useStyles();
  const nameOf = useMemberNames();
  const { t, st, tt, locale } = useI18n();
  const m = DOCUMENT_MESSAGES[locale];
  const [readingTask, setReadingTask] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const compact = useSyncExternalStore(
    compactTaskLayout.subscribe,
    compactTaskLayout.current,
    desktopTaskLayout.current,
  );
  const restoreNavFocus = useRestoreFocusTarget();
  const [navOpen, setNavOpen] = useState(false);
  if (!compact && navOpen) setNavOpen(false);
  const vm = buildTaskViewModel(process, state);
  const { task, stage, status, locked, record, previous: prev, reopen } = vm;
  const hint = vm.hint ? hintText(vm.hint, t, (item) => tt(item).name) : null;
  const primaryBlock = blockOf(vm.primary.action);
  const completing = vm.primary.action.type === 'completeTask' || vm.primary.action.type === 'completeAndNext';
  const invalid = validateTaskDocument(task.id, record);
  const reading = readingTask === task.id;
  const documentReason = completing
    ? reading
      ? m.filePending
      : invalid.length
        ? m.missing
        : persistence === 'error'
          ? m.saveError
          : hasUnsavedChanges
            ? m.saveFirst
            : null
    : null;
  const primaryDisabled =
    vm.primary.disabled ||
    primaryBlock !== null ||
    submitting ||
    (completing && (invalid.length > 0 || reading || persistence === 'error'));
  const submitPrimary = async () => {
    if (primaryDisabled) return;
    if (vm.primary.action.type === 'approveStage') {
      dispatch({ type: 'setView', view: 'stage' });
      return;
    }
    setSubmitting(true);
    try {
      if (!flush || (await flush())) dispatch(vm.primary.action);
    } finally {
      setSubmitting(false);
    }
  };
  const primaryReason = primaryBlock
    ? actionBlockText(primaryBlock, t, nameOf)
    : vm.primary.disabled
      ? (hint ?? documentReason)
      : documentReason;
  const recordBlocked = blockOf({ type: 'updateRecord', taskId: task.id, patch: {} }) !== null;
  const canReopen = reopen && !blockOf(reopen.action);
  const canRework = vm.reworkPreview && !blockOf({ type: 'requestRework', taskId: task.id, reason: '' });
  const responsible = responsibleFor(process, assignments, task.id);
  const accountable = accountableFor(assignments, stage.id);

  return (
    <div className={styles.root}>
      <TaskNav
        process={process}
        state={state}
        dispatch={dispatch}
        compact={compact}
        open={navOpen}
        setOpen={setNavOpen}
      />

      <section aria-labelledby="task-title" className={styles.main}>
        <Card size="large">
          {compact && (
            <Button
              appearance="subtle"
              icon={<PanelLeft20Regular />}
              {...restoreNavFocus}
              aria-haspopup="dialog"
              className={styles.navToggle}
              onClick={() => setNavOpen(true)}
            >
              {t.taskNavLabel}
            </Button>
          )}
          <Breadcrumb aria-label={t.breadcrumbLabel} list={{ className: styles.path }}>
            <BreadcrumbItem>
              <BreadcrumbButton onClick={() => dispatch({ type: 'setView', view: 'board' })}>
                {t.breadcrumbAll}
              </BreadcrumbButton>
            </BreadcrumbItem>
            <BreadcrumbDivider />
            <BreadcrumbItem>
              <BreadcrumbButton onClick={() => dispatch({ type: 'setView', view: 'stage' })}>
                {t.stageWithName(stage.index + 1, st(stage).name)}
              </BreadcrumbButton>
            </BreadcrumbItem>
            <BreadcrumbDivider />
            <BreadcrumbItem>
              <BreadcrumbButton current>{t.task(task.number)}</BreadcrumbButton>
            </BreadcrumbItem>
          </Breadcrumb>
          <div className={styles.titleRow}>
            <Title3 as="h2" id="task-title" className={styles.heading}>
              {tt(task).name}
            </Title3>
            <TaskStatusBadge status={status} rework={vm.rework} />
          </div>
          <Text className={styles.muted}>{tt(task).description}</Text>
          {(responsible.length > 0 || accountable) && (
            <Caption1 className={styles.subtle}>
              {[
                responsible.length > 0 ? t.responsibleLabel(namesOf(responsible, nameOf, t)) : null,
                accountable ? t.accountableLabel(nameOf(accountable) ?? t.unknownUser) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Caption1>
          )}
          <ReworkBanner />
          {hint && (
            <MessageBar intent="info">
              <MessageBarBody>{hint}</MessageBarBody>
            </MessageBar>
          )}
          {primaryBlock && primaryReason && primaryReason !== hint && (
            <MessageBar intent="info">
              <MessageBarBody>{primaryReason}</MessageBarBody>
            </MessageBar>
          )}
          {reopen && canReopen && reopen.revokesApproval !== null && (
            <MessageBar intent="warning">
              <MessageBarBody>{t.reopenRevokesApproval(reopen.revokesApproval + 1)}</MessageBarBody>
            </MessageBar>
          )}
        </Card>

        <RecoveredDrafts disabled={reading || submitting} />

        <div className={styles.pair}>
          <Card size="large" role="region" aria-labelledby="task-input-title" className={styles.small}>
            <Caption1Strong as="h3" id="task-input-title" className={styles.subtle}>
              {t.inheritedOutput}
            </Caption1Strong>
            <Subtitle2>{prev ? tt(prev).output : t.none}</Subtitle2>
            <Caption1 className={styles.subtle}>
              {prev ? t.fromTask(prev.number, tt(prev).name) : t.firstTaskNote}
            </Caption1>
          </Card>
          <Card size="large" role="region" aria-labelledby="task-output-title" className={styles.small}>
            <Caption1Strong as="h3" id="task-output-title" className={styles.subtle}>
              {t.thisOutput}
            </Caption1Strong>
            <Subtitle2>{tt(task).output}</Subtitle2>
          </Card>
        </div>

        {prev && (
          <details>
            <summary>
              {m.prior} · {tt(prev).name}
            </summary>
            <TaskDocumentResult taskId={prev.id} />
          </details>
        )}
        <TaskDocument
          key={task.id}
          taskId={task.id}
          done={vm.done}
          readOnly={locked || recordBlocked || vm.done || submitting || reading}
          onBusyChange={(busy) => setReadingTask(busy ? task.id : null)}
        />
        <Card className={styles.actions}>
          <DisabledReason reason={primaryReason}>
            <Button appearance="primary" disabledFocusable={primaryDisabled} onClick={() => void submitPrimary()}>
              {labelText(vm.primary.label, t)}
            </Button>
          </DisabledReason>
          <Button
            appearance="subtle"
            disabled={!prev}
            onClick={() => prev && dispatch({ type: 'selectTask', taskId: prev.id })}
          >
            {t.prevTask}
          </Button>
          {reopen && canReopen && (
            <Button appearance="subtle" onClick={() => dispatch(reopen.action)}>
              {t.undoDone}
            </Button>
          )}
          {vm.reworkPreview && canRework && (
            <ReworkDialog
              preview={vm.reworkPreview}
              onConfirm={(reason) => dispatch({ type: 'requestRework', taskId: task.id, reason })}
            />
          )}
        </Card>
      </section>
    </div>
  );
}
