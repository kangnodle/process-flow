import {
  Badge,
  Button,
  Caption1,
  Checkbox,
  MessageBar,
  MessageBarBody,
  Radio,
  Subtitle2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  type Assignments,
  type AssignmentsInput,
  frontStage,
  type Member,
  NO_ASSIGNMENTS,
  type Process,
} from '@process-flow/domain';
import { useEffect, useState } from 'react';
import { errorKindOf, type RequestErrorKind } from '@process-flow/application';
import { useProjects, useWorkflow } from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';
import { AssignmentStageStepper } from '../components/AssignmentStageStepper';
import { InlineError } from '../components/InlineError';
import { PageLayout } from './PageLayout';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  note: { color: tokens.colorNeutralForeground3 },
  table: { borderCollapse: 'collapse', width: '100%' },
  head: {
    textAlign: 'center',
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase200,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  name: { textAlign: 'left', padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}` },
  cell: { textAlign: 'center', borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}` },
  panel: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  section: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalS },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
});

const STAGE_PANEL_ID = 'assignment-stage-panel';
const stageTabId = (stageId: string) => `assignment-step-${stageId}`;

type Kind = 'responsible' | 'consulted' | 'informed';
const KINDS: readonly Kind[] = ['responsible', 'consulted', 'informed'];

interface Draft {
  readonly accountable: Readonly<Record<string, string | undefined>>;
  readonly stage: Readonly<Record<Kind, Readonly<Record<string, ReadonlySet<string>>>>>;
  readonly task: Readonly<Record<string, ReadonlySet<string>>>;
}

const EMPTY: ReadonlySet<string> = new Set();

function toDraft(assignments: Assignments): Draft {
  const byKind = (kind: Kind) =>
    Object.fromEntries(assignments.stages.map((stage) => [stage.stageId, new Set(stage[kind])]));
  return {
    accountable: Object.fromEntries(assignments.stages.map((stage) => [stage.stageId, stage.accountable])),
    stage: { responsible: byKind('responsible'), consulted: byKind('consulted'), informed: byKind('informed') },
    task: Object.fromEntries(assignments.tasks.map((task) => [task.taskId, new Set(task.responsible)])),
  };
}

function toInput(process: Process, draft: Draft): AssignmentsInput {
  const list = (set: ReadonlySet<string> | undefined) => [...(set ?? EMPTY)].sort();
  return {
    stages: process.stages.flatMap((stage) => {
      const accountable = draft.accountable[stage.id];
      const entry = {
        stageId: stage.id,
        ...(accountable ? { accountable } : {}),
        responsible: list(draft.stage.responsible[stage.id]),
        consulted: list(draft.stage.consulted[stage.id]),
        informed: list(draft.stage.informed[stage.id]),
      };
      const empty = !accountable && !entry.responsible.length && !entry.consulted.length && !entry.informed.length;
      return empty ? [] : [entry];
    }),
    tasks: process.tasks.flatMap((task) => {
      const responsible = list(draft.task[task.id]);
      return responsible.length ? [{ taskId: task.id, responsible }] : [];
    }),
  };
}

const toggled = (set: ReadonlySet<string> | undefined, id: string, on: boolean): ReadonlySet<string> => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

export function AssignmentsPage() {
  const { assignments = NO_ASSIGNMENTS, saveAssignments, workspace } = useWorkflow();
  const projects = useProjects();
  const { t } = useI18n();
  const [savedNotice, setSavedNotice] = useState(false);
  const reloadMembers = projects?.reloadMembers;
  useEffect(() => {
    reloadMembers?.();
  }, [reloadMembers]);
  if (!saveAssignments || !projects?.users) return null;
  return (
    <PageLayout
      title={t.assignments}
      {...(workspace?.name
        ? {
            titleAddon: (
              <Badge appearance="tint" color="informative">
                {workspace.name}
              </Badge>
            ),
          }
        : {})}
      description={t.assignmentsDescription}
    >
      {projects.membersError && <InlineError message={t.memberLoadFailed} onRetry={projects.reloadMembers} />}
      <Editor
        key={assignments.version}
        saved={assignments}
        members={projects.members}
        savedNotice={savedNotice}
        onSavedNotice={setSavedNotice}
      />
    </PageLayout>
  );
}

function Editor({
  saved,
  members,
  savedNotice,
  onSavedNotice,
}: {
  readonly saved: Assignments;
  readonly members: readonly Member[];
  readonly savedNotice: boolean;
  readonly onSavedNotice: (shown: boolean) => void;
}) {
  const styles = useStyles();
  const { t, st, tt } = useI18n();
  const { process, state, permissions, saveAssignments, reload, workspace } = useWorkflow();
  const canManage = permissions ? permissions.includes('assignments.manage') : true;
  const [stageId, setStageId] = useState(() => process.stages[frontStage(process, state)]?.id ?? '');
  const [draft, setDraft] = useState(() => toDraft(saved));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorKind | undefined>();
  const stage = process.stages.find((item) => item.id === stageId) ?? process.stages[0];
  if (!stage) return null;

  const input = toInput(process, draft);
  const dirty = JSON.stringify(input) !== JSON.stringify(toInput(process, toDraft(saved)));
  const canExecute = (member: Member) => member.role !== 'viewer' && member.user.active;
  const change = (next: Draft) => {
    setDraft(next);
    onSavedNotice(false);
    setError(undefined);
  };
  const setStageKind = (kind: Kind, memberId: string, on: boolean) =>
    change({
      ...draft,
      stage: {
        ...draft.stage,
        [kind]: { ...draft.stage[kind], [stage.id]: toggled(draft.stage[kind][stage.id], memberId, on) },
      },
    });

  const save = async () => {
    if (!saveAssignments) return;
    setBusy(true);
    setError(undefined);
    try {
      onSavedNotice(false);
      await saveAssignments(input);
      onSavedNotice(true);
    } catch (reason) {
      const kind = errorKindOf(reason);
      setError(kind);
      if (kind === 'versionConflict') void reload?.();
    } finally {
      setBusy(false);
    }
  };

  const stageName = st(stage).name;
  return (
    <>
      <AssignmentStageStepper
        label={t.assignmentStage}
        panelId={STAGE_PANEL_ID}
        tabIdFor={stageTabId}
        selectedId={stage.id}
        onSelect={setStageId}
        steps={process.stages.map((item) => {
          const accountable = draft.accountable[item.id];
          return {
            id: item.id,
            index: item.index,
            name: st(item).name,
            summary: t.assignmentStageSummary(
              members.find((member) => member.user.id === accountable)?.user.name,
              draft.stage.responsible[item.id]?.size ?? 0,
            ),
            hasAccountable: Boolean(accountable),
          };
        })}
      />
      {!canManage && (
        <Caption1 className={styles.note}>
          {workspace?.projectArchived ? t.archivedNotice : t.assignmentsOwnerOnly}
        </Caption1>
      )}
      <div role="tabpanel" id={STAGE_PANEL_ID} aria-labelledby={stageTabId(stage.id)} className={styles.panel}>
        {members.length === 0 ? (
          <Caption1 className={styles.note}>{t.assignmentsNeedMembers}</Caption1>
        ) : (
          <>
            <table className={styles.table} aria-label={t.stageRaciTable(stageName)}>
              <thead>
                <tr>
                  <th className={styles.head} scope="col">
                    {t.raciMember}
                  </th>
                  {(['accountable', ...KINDS] as const).map((kind) => (
                    <th key={kind} className={styles.head} scope="col">
                      {t.raciColumn[kind]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.user.id}>
                    <th className={styles.name} scope="row">
                      {member.user.name}
                    </th>
                    <td className={styles.cell}>
                      <Radio
                        name={`accountable-${stage.id}`}
                        aria-label={t.raciCell('accountable', member.user.name)}
                        checked={draft.accountable[stage.id] === member.user.id}
                        disabled={!canManage || !canExecute(member)}
                        onChange={() =>
                          change({ ...draft, accountable: { ...draft.accountable, [stage.id]: member.user.id } })
                        }
                      />
                    </td>
                    {KINDS.map((kind) => (
                      <td key={kind} className={styles.cell}>
                        <Checkbox
                          aria-label={t.raciCell(kind, member.user.name)}
                          checked={draft.stage[kind][stage.id]?.has(member.user.id) ?? false}
                          disabled={!canManage || (kind === 'responsible' && !canExecute(member))}
                          onChange={(_, data) => setStageKind(kind, member.user.id, data.checked === true)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th className={styles.name} scope="row">
                    {t.noAccountable}
                  </th>
                  <td className={styles.cell}>
                    <Radio
                      name={`accountable-${stage.id}`}
                      aria-label={t.noAccountable}
                      checked={!draft.accountable[stage.id]}
                      disabled={!canManage}
                      onChange={() =>
                        change({ ...draft, accountable: { ...draft.accountable, [stage.id]: undefined } })
                      }
                    />
                  </td>
                  <td colSpan={KINDS.length} />
                </tr>
              </tbody>
            </table>
            {members.some((member) => member.role === 'viewer') && (
              <Caption1 className={styles.note}>{t.viewerCannotExecute}</Caption1>
            )}

            <section className={styles.section} aria-labelledby="task-responsible-title">
              <Subtitle2 as="h2" id="task-responsible-title">
                {t.taskResponsible}
              </Subtitle2>
              <Caption1 className={styles.note}>{t.taskResponsibleHint}</Caption1>
              {stage.tasks.map((task) => (
                <div key={task.id} role="group" aria-label={tt(task).name}>
                  <Caption1 block>{`${task.number}. ${tt(task).name}`}</Caption1>
                  <div className={styles.row}>
                    {members.filter(canExecute).map((member) => (
                      <Checkbox
                        key={member.user.id}
                        label={member.user.name}
                        aria-label={t.taskResponsibleCell(tt(task).name, member.user.name)}
                        checked={draft.task[task.id]?.has(member.user.id) ?? false}
                        disabled={!canManage}
                        onChange={(_, data) =>
                          change({
                            ...draft,
                            task: {
                              ...draft.task,
                              [task.id]: toggled(draft.task[task.id], member.user.id, data.checked === true),
                            },
                          })
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
      {error && (
        <InlineError message={error === 'versionConflict' ? t.assignmentsChangedElsewhere : t.projectError[error]} />
      )}
      {savedNotice && !dirty && (
        <MessageBar intent="success">
          <MessageBarBody>{t.assignmentsSaved}</MessageBarBody>
        </MessageBar>
      )}
      {canManage && (
        <div className={styles.row}>
          <Button appearance="primary" disabled={busy || !dirty} onClick={() => void save()}>
            {t.save}
          </Button>
        </div>
      )}
    </>
  );
}
