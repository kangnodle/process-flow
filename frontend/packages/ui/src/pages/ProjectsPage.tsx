import {
  Badge,
  Body1Strong,
  Button,
  Caption1,
  Divider,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  Subtitle2,
  Switch,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from '@fluentui/react-components';
import {
  Delete20Regular,
  Add20Regular,
  Archive20Regular,
  ArchiveArrowBack20Regular,
  Edit20Regular,
} from '@fluentui/react-icons';
import { getStage, type Permission, type Phase, type Project } from '@process-flow/domain';
import { useMemo, useState, type FormEvent } from 'react';
import {
  errorKindOf,
  hasIssues,
  HOME,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  projectFormIssues,
  type RequestErrorKind,
} from '@process-flow/application';
import {
  type ProjectsContextValue,
  useNavigation,
  useManagementQuery,
  useProjects,
  useSwitchBlocked,
  useWorkflow,
} from '@process-flow/react';
import type { Messages } from '../i18n/messages';
import { useI18n } from '../i18n/useI18n';
import { useFocusOnClose } from '../components/drawerFocus';
import { ProjectMembers } from '../components/ProjectMembers';
import { PageLayout } from './PageLayout';

const useStyles = makeStyles({
  body: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL },
  note: { color: tokens.colorNeutralForeground3 },
  row: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  list: { listStyleType: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalS} 0`,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  hoverRow: {
    marginLeft: `calc(${tokens.spacingHorizontalS} * -1)`,
    marginRight: `calc(${tokens.spacingHorizontalS} * -1)`,
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  projectButton: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    textAlign: 'start',
    minWidth: 0,
    paddingTop: tokens.spacingVerticalS,
    paddingBottom: tokens.spacingVerticalS,
  },
  itemText: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXXS, minWidth: 0 },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  form: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalM },
  description: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  divider: { flexGrow: 0 },
});

type Copy = Messages;

function phaseText(t: Copy, stageName: (index: number) => string, phase: Phase): string {
  if (phase.kind === 'finished') return t.processComplete;
  const stage = t.stageWithName(phase.stageIndex + 1, stageName(phase.stageIndex));
  return `${stage} · ${phase.kind === 'awaitingApproval' ? t.statusAwaitingApproval : t.stageInProgress}`;
}

export function ProjectsPage() {
  const projects = useProjects();
  const { t } = useI18n();
  const { navigate } = useNavigation();
  if (!projects) return null;
  return (
    <PageLayout title={t.projects} description={t.projectsDescription}>
      {projects.currentProjectError && (
        <ErrorBar
          kind={projects.currentProjectError}
          message={t.currentProjectLoadFailed}
          onRetry={projects.reloadCurrentProject}
        />
      )}
      <ProjectList projects={projects} onSelect={(projectId) => navigate({ page: 'project', projectId })} />
    </PageLayout>
  );
}

function ErrorBar({
  kind,
  message,
  onRetry,
}: {
  readonly kind: RequestErrorKind;
  readonly message?: string;
  readonly onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <MessageBar intent="error">
      <MessageBarBody>{message ?? t.projectError[kind]}</MessageBarBody>
      {onRetry && (
        <MessageBarActions>
          <Button size="small" onClick={onRetry}>
            {t.retry}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

function ProjectForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  readonly initial?: { readonly name: string; readonly description: string };
  readonly submitLabel: string;
  readonly onSubmit: (name: string, description: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = projectFormIssues(name, description);
  const shown = touched ? issues : {};

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (hasIssues(issues)) return;
    setBusy(true);
    try {
      await onSubmit(name.trim(), description.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field
        label={t.projectName}
        required
        {...(shown.name
          ? { validationState: 'error' as const, validationMessage: t.projectNameRule(PROJECT_NAME_MAX) }
          : {})}
      >
        <Input value={name} onChange={(_, data) => setName(data.value)} onBlur={() => setTouched(true)} autoFocus />
      </Field>
      <Field
        label={t.projectDescription}
        {...(shown.description
          ? {
              validationState: 'error' as const,
              validationMessage: t.projectDescriptionRule(PROJECT_DESCRIPTION_MAX),
            }
          : {})}
      >
        <Textarea value={description} onChange={(_, data) => setDescription(data.value)} resize="vertical" />
      </Field>
      <div className={styles.row}>
        <Button type="submit" appearance="primary" disabled={busy}>
          {submitLabel}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}

function ProjectBadges({ project, current }: { readonly project: Project; readonly current: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {current && (
        <Badge appearance="filled" color="brand">
          {t.badgeCurrent}
        </Badge>
      )}
      {project.archived && (
        <Badge appearance="tint" color="subtle">
          {t.badgeArchived}
        </Badge>
      )}
    </>
  );
}

function ProjectList({
  projects,
  onSelect,
}: {
  readonly projects: ProjectsContextValue;
  readonly onSelect: (projectId: string) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const { projects: management, currentProject } = projects;
  const [includeArchived, setIncludeArchived] = useState(false);
  const query = useMemo(() => management.observeList(), [management]);
  const listState = useManagementQuery(query, includeArchived);
  const items = 'data' in listState ? listState.data : undefined;
  const loadError = listState.status === 'failed' ? listState.error : undefined;
  const load = query.reload;
  const [createError, setCreateError] = useState<RequestErrorKind | undefined>();
  const [creating, setCreating] = useState(false);
  const newProjectRef = useFocusOnClose(creating);

  const create = async (name: string, description: string) => {
    try {
      const project = await management.create({ name, ...(description ? { description } : {}) });
      setCreating(false);
      setCreateError(undefined);
      onSelect(project.id);
    } catch (reason) {
      setCreateError(errorKindOf(reason));
    }
  };

  return (
    <>
      <div className={styles.row}>
        <Switch
          checked={includeArchived}
          onChange={(_, data) => setIncludeArchived(data.checked)}
          label={t.showArchived}
        />
        <span className={styles.spacer} />
        {!creating && (
          <Button ref={newProjectRef} icon={<Add20Regular />} onClick={() => setCreating(true)}>
            {t.newProject}
          </Button>
        )}
      </div>
      {creating && (
        <section aria-label={t.newProject}>
          <Subtitle2 as="h2" block>
            {t.newProject}
          </Subtitle2>
          <ProjectForm
            submitLabel={t.create}
            onSubmit={create}
            onCancel={() => {
              setCreating(false);
              setCreateError(undefined);
            }}
          />
          {createError && <ErrorBar kind={createError} />}
        </section>
      )}
      {loadError && <ErrorBar kind={loadError} onRetry={load} />}
      {!items && !loadError && <Spinner size="small" label={t.loading} />}
      {items && items.length === 0 && (
        <Caption1 className={styles.note}>{includeArchived ? t.noProjects : t.noActiveProjects}</Caption1>
      )}
      {items && items.length > 0 && (
        <ul className={styles.list} aria-label={t.allProjects}>
          {items.map((project) => (
            <li key={project.id} className={styles.item}>
              <Button appearance="subtle" className={styles.projectButton} onClick={() => onSelect(project.id)}>
                <span className={styles.itemText}>
                  <span className={styles.row}>
                    <Body1Strong className={styles.ellipsis}>{project.name}</Body1Strong>
                    <ProjectBadges project={project} current={project.id === currentProject?.id} />
                  </span>
                  {project.description && (
                    <Caption1 className={mergeClasses(styles.note, styles.ellipsis)}>{project.description}</Caption1>
                  )}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function ProjectDetailPage({ projectId }: { readonly projectId: string }) {
  const projects = useProjects();
  if (!projects) return null;
  return <ProjectDetail key={projectId} projects={projects} projectId={projectId} />;
}

function ProjectDetail({
  projects,
  projectId,
}: {
  readonly projects: ProjectsContextValue;
  readonly projectId: string;
}) {
  const styles = useStyles();
  const { t, st } = useI18n();
  const { process } = useWorkflow();
  const { navigate } = useNavigation();
  const {
    projects: management,
    memberManagement,
    currentProject,
    currentProjectId,
    currentWorkflowId,
    openWorkflow,
  } = projects;
  const switchBlocked = useSwitchBlocked();
  const query = useMemo(() => management.observeDetail(), [management]);
  const detailState = useManagementQuery(query, projectId);
  const detail = 'data' in detailState ? detailState.data : undefined;
  const project = detail?.project;
  const workflows = detail?.workflows;
  const loadError = detailState.status === 'failed' ? detailState.error : undefined;
  const load = query.reload;
  const [error, setError] = useState<RequestErrorKind | undefined>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [workflowName, setWorkflowName] = useState('');
  const loaded = project !== undefined;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      const kind = errorKindOf(reason);
      setError(kind);
      if (kind === 'versionConflict' || kind === 'conflict' || kind === 'notFound') load();
    } finally {
      setBusy(false);
    }
  };

  const saved = (updated: Project) => {
    query.replace({ project: updated, workflows: workflows ?? [] });
  };

  const open = async (workflowId: string) => {
    await openWorkflow(workflowId);
    navigate(HOME);
  };

  const trail = [{ label: t.projects, route: { page: 'projects' } as const }];
  if (!project) {
    return (
      <PageLayout trail={trail} title={loadError ? t.projects : t.loading} focusKey={loaded}>
        {loadError ? <ErrorBar kind={loadError} onRetry={load} /> : <Spinner size="small" label={t.loading} />}
      </PageLayout>
    );
  }

  const stageName = (index: number) => st(getStage(process, index)).name;
  const can = (permission: Permission) => project.permissions.includes(permission);
  return (
    <PageLayout
      trail={trail}
      title={project.name}
      titleAddon={<ProjectBadges project={project} current={project.id === currentProject?.id} />}
      focusKey={`${loaded}:${editing}`}
    >
      {loadError && <ErrorBar kind={loadError} onRetry={load} />}
      {editing ? (
        <section aria-label={t.edit}>
          <ProjectForm
            initial={project}
            submitLabel={t.save}
            onCancel={() => setEditing(false)}
            onSubmit={(name, description) =>
              run(async () => {
                saved(await management.update(project, { name, description }));
                setEditing(false);
              })
            }
          />
        </section>
      ) : (
        <section aria-label={t.projectSummary}>
          {project.description && <p className={styles.description}>{project.description}</p>}
          <Caption1 className={styles.note} block>
            {t.yourRole(t.roleLabel[project.role])}
          </Caption1>
          {can('project.edit') && (
            <div className={styles.row}>
              <Button icon={<Edit20Regular />} onClick={() => setEditing(true)} disabled={busy}>
                {t.edit}
              </Button>
              <Button
                icon={project.archived ? <ArchiveArrowBack20Regular /> : <Archive20Regular />}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    saved(await management.update(project, { archived: !project.archived }));
                  })
                }
              >
                {project.archived ? t.unarchiveProject : t.archiveProject}
              </Button>
              {project.archived && (
                <Dialog>
                  <DialogTrigger disableButtonEnhancement>
                    <Button
                      icon={<Delete20Regular />}
                      disabled={busy || (project.id === currentProjectId && switchBlocked)}
                    >
                      {t.deleteProject}
                    </Button>
                  </DialogTrigger>
                  <DialogSurface>
                    <DialogBody>
                      <DialogTitle>
                        {t.deleteProject} · {project.name}
                      </DialogTitle>
                      <DialogContent>{t.deleteProjectWarning}</DialogContent>
                      <DialogActions>
                        <DialogTrigger disableButtonEnhancement>
                          <Button>{t.cancel}</Button>
                        </DialogTrigger>
                        <Button
                          appearance="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await management.deleteArchived(project);
                              navigate({ page: 'projects' });
                            })
                          }
                        >
                          {t.deleteProject}
                        </Button>
                      </DialogActions>
                    </DialogBody>
                  </DialogSurface>
                </Dialog>
              )}
            </div>
          )}
        </section>
      )}
      {error && <ErrorBar kind={error} />}
      {project.archived && (
        <MessageBar intent="warning">
          <MessageBarBody>{t.archivedNotice}</MessageBarBody>
        </MessageBar>
      )}

      <Divider className={styles.divider} />
      <section aria-labelledby="project-workflows">
        <Subtitle2 as="h2" id="project-workflows" block>
          {t.workflows}
        </Subtitle2>
        <Caption1 className={styles.note} block>
          {t.workflowExplainer(process.stages.length, process.tasks.length)}
        </Caption1>
        {switchBlocked && (
          <MessageBar intent="warning">
            <MessageBarBody>{t.unsavedBlocksSwitch}</MessageBarBody>
          </MessageBar>
        )}
        {workflows && workflows.length === 0 && <Caption1 className={styles.note}>{t.noWorkflows}</Caption1>}
        {workflows && workflows.length > 0 && (
          <ul className={styles.list} aria-label={t.workflows}>
            {workflows.map((workflow) => (
              <li key={workflow.id} className={mergeClasses(styles.item, styles.hoverRow)}>
                <span className={mergeClasses(styles.itemText, styles.spacer)}>
                  <Body1Strong className={styles.ellipsis}>{workflow.name}</Body1Strong>
                  <Caption1 className={styles.note}>{phaseText(t, stageName, workflow.phase)}</Caption1>
                </span>
                {workflow.id === currentWorkflowId ? (
                  <Badge appearance="filled" color="brand">
                    {t.openedWorkflow}
                  </Badge>
                ) : (
                  <Button
                    aria-label={t.openWorkflow(workflow.name)}
                    disabled={busy || switchBlocked}
                    onClick={() => void run(() => open(workflow.id))}
                  >
                    {t.open}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!project.archived && can('workflow.start') && (
        <form
          className={styles.form}
          aria-label={t.newWorkflow}
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await management.startWorkflow(project, workflowName);
              setWorkflowName('');
              navigate(HOME);
            });
          }}
        >
          <Field label={t.workflowName} hint={t.workflowNameHint}>
            <Input
              value={workflowName}
              placeholder={t.workflowNamePlaceholder}
              onChange={(_, data) => setWorkflowName(data.value)}
            />
          </Field>
          <div className={styles.row}>
            <Button type="submit" icon={<Add20Regular />} disabled={busy || switchBlocked}>
              {t.startWorkflow}
            </Button>
          </div>
        </form>
      )}
      {memberManagement && (
        <>
          <Divider className={styles.divider} />
          <ProjectMembers
            management={memberManagement}
            projectId={project.id}
            canManage={can('members.manage')}
            onChanged={load}
          />
        </>
      )}
    </PageLayout>
  );
}
