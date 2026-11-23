import {
  Body1Strong,
  Button,
  Card,
  Caption1,
  Subtitle1,
  Text,
  createFocusOutlineStyle,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from '@fluentui/react-components';
import { buildBoardViewModel, type ColumnHint } from '@process-flow/application';
import { getRecord, taskForm, validateTaskDocument } from '@process-flow/domain';
import { DOCUMENT_MESSAGES } from '../i18n/documentMessages';
import { useWorkflow } from '@process-flow/react';
import { TaskStatusBadge } from '../components/TaskStatusBadge';
import type { Messages } from '../i18n/messages';
import { useI18n } from '../i18n/useI18n';

const useStyles = makeStyles({
  root: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  head: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
  },
  muted: { color: tokens.colorNeutralForeground2 },
  subtle: { color: tokens.colorNeutralForeground3 },
  brand: { color: tokens.colorBrandForeground1 },
  scroller: { overflowX: 'auto', padding: '2px 2px 6px' },
  board: {
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    minWidth: '1180px',
    display: 'grid',
    gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
    gap: tokens.spacingHorizontalM,
    alignItems: 'start',
  },
  column: {
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusXLarge,
    padding: tokens.spacingHorizontalS,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  columnCurrent: { boxShadow: `inset 0 0 0 ${tokens.strokeWidthThick} ${tokens.colorBrandStroke1}` },
  columnHead: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
  },
  columnTitle: { flexGrow: 1, margin: 0 },
  cards: {
    listStyleType: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  card: {
    padding: 0,
    gap: 0,
    alignItems: 'stretch',
    transitionProperty: 'background-color',
    transitionDuration: tokens.durationFaster,
    transitionTimingFunction: tokens.curveEasyEase,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    ':active': { backgroundColor: tokens.colorNeutralBackground1Pressed },
  },
  cardSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Selected },
    '::after': {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      ...shorthands.borderWidth(tokens.strokeWidthThick),
    },
  },
  cardLocked: {
    backgroundColor: tokens.colorNeutralBackgroundDisabled,
    boxShadow: 'none',
    '::after': { ...shorthands.borderColor(tokens.colorNeutralStrokeDisabled) },
  },
  textLocked: { color: tokens.colorNeutralForegroundDisabled },
  reworkMark: { color: tokens.colorPaletteDarkOrangeForeground1 },
  cardButton: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: '56px',
    padding: tokens.spacingHorizontalM,
    border: 'none',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    ...createFocusOutlineStyle({ style: { outlineOffset: '-2px' } }),
  },
  hint: { padding: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS}` },
  drawerBody: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  field: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS },
  divider: {
    paddingTop: tokens.spacingVerticalL,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  drawerFooter: { justifyContent: 'flex-end' },
});

function columnHintText(hint: ColumnHint, t: Messages): string {
  switch (hint.kind) {
    case 'unlocksAfter':
      return t.unlocksAfter(hint.stageIndex);
    case 'allStagesDone':
      return t.allStagesDone;
    case 'awaitingApproval':
      return t.columnAwaitingApproval;
    case 'tasksLeft':
      return t.tasksLeft(hint.count);
  }
}

export function BoardView() {
  const styles = useStyles();
  const { process, state, dispatch, blockOf } = useWorkflow();
  const { t, st, tt, locale } = useI18n();
  const m = DOCUMENT_MESSAGES[locale];
  const vm = buildBoardViewModel(process, state);
  const { current } = vm;
  const selected = vm.selected.task;

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <Subtitle1 as="h2">{t.boardTitle}</Subtitle1>
        <Text className={styles.muted}>
          {t.boardCurrent}{' '}
          <Body1Strong className={styles.brand}>{t.stageWithName(current.index + 1, st(current).name)}</Body1Strong>{' '}
          {t.boardHint}
        </Text>
      </div>

      <div className={styles.scroller}>
        <ol className={styles.board} aria-label={t.boardListLabel(vm.columns.length)}>
          {vm.columns.map((column) => {
            const { stage, locked, isFrontier: isCurrent, progress, tasks } = column;
            const hint = column.hint ? columnHintText(column.hint, t) : null;

            return (
              <li key={stage.index} className={mergeClasses(styles.column, isCurrent && styles.columnCurrent)}>
                <div className={styles.columnHead}>
                  <Body1Strong as="h3" className={styles.columnTitle}>
                    {stage.index + 1}. {st(stage).name}
                  </Body1Strong>
                  <Caption1 className={styles.subtle}>
                    {locked ? t.statusLocked : `${progress.done}/${progress.total}`}
                  </Caption1>
                </div>
                <ul className={styles.cards}>
                  {tasks.map(({ task, done, rework, status }) => (
                    <li key={task.id}>
                      <Card
                        size="small"
                        orientation="horizontal"
                        className={mergeClasses(
                          styles.card,
                          task.id === selected.id && styles.cardSelected,
                          locked && styles.cardLocked,
                        )}
                      >
                        <button
                          type="button"
                          className={styles.cardButton}
                          onClick={() => dispatch({ type: 'selectTask', taskId: task.id, view: 'task' })}
                        >
                          <Caption1 className={locked ? styles.textLocked : styles.subtle}>
                            {t.task(task.number)}
                            {rework && (
                              <span className={styles.reworkMark}>
                                {' · '}
                                {status === 'doing' ? t.statusRedoing : t.statusRedoTodo}
                              </span>
                            )}
                          </Caption1>
                          <span className={locked ? styles.textLocked : undefined}>{tt(task).name}</span>
                          <TaskStatusBadge status={status} rework={rework} />
                          <Caption1>
                            {done && validateTaskDocument(task.id, getRecord(state, task.id)).length > 0
                              ? m.legacy.split('.')[0]
                              : m.count(
                                  taskForm(task.id).filter(
                                    (f) => !validateTaskDocument(task.id, getRecord(state, task.id)).includes(f.id),
                                  ).length,
                                  taskForm(task.id).length,
                                )}
                          </Caption1>
                        </button>
                      </Card>
                    </li>
                  ))}
                </ul>
                {column.canApprove && !blockOf({ type: 'approveStage', stageIndex: stage.index }) && (
                  <Button
                    appearance="primary"
                    onClick={() => dispatch({ type: 'selectTask', taskId: stage.tasks[0]!.id, view: 'stage' })}
                  >
                    {m.reviewStage}
                  </Button>
                )}
                {hint && <Caption1 className={mergeClasses(styles.subtle, styles.hint)}>{hint}</Caption1>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
