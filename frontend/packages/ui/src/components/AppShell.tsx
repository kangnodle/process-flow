import {
  Badge,
  Body1Strong,
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Caption1,
  ProgressBar,
  Subtitle2,
  Tab,
  TabList,
  Title3,
  Toast,
  ToastBody,
  ToastTitle,
  Toaster,
  Tooltip,
  makeStyles,
  Spinner,
  tokens,
  useId,
  useToastController,
  type SelectTabData,
} from '@fluentui/react-components';
import {
  Add20Regular,
  Board20Regular,
  FolderOpen20Regular,
  People20Regular,
  PersonAvailable20Regular,
  PanelLeft20Regular,
  Settings20Regular,
  TextBulletListLtr20Regular,
} from '@fluentui/react-icons';
import { frontStage, getStage, isViewMode, overallProgress, progressKey, type ViewMode } from '@process-flow/domain';
import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from 'react';
import { HOME, type CompactTaskLayoutSource, type RequestErrorKind, type Route } from '@process-flow/application';
import {
  shallowEqual,
  useMyWork,
  useNavigation,
  useProjects,
  useWorkflowSelector,
  type WorkflowContextValue,
} from '@process-flow/react';
import { useI18n } from '../i18n/useI18n';
import { AccountMenu } from './AccountMenu';
import { MyWork } from './MyWork';
import { OverrideDialog } from './OverrideDialog';
import { ReworkBanner } from './ReworkBanner';
import { BoardView } from '../views/BoardView';
import { StageView } from '../views/StageView';
import { TaskView } from '../views/TaskView';
import { MyWorkPage } from '../pages/MyWorkPage';
import { SettingsDrawer } from './SettingsDrawer';

const useStyles = makeStyles({
  root: { minHeight: '100vh', backgroundColor: tokens.colorNeutralBackground2, color: tokens.colorNeutralForeground1 },
  bar: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  inner: {
    maxWidth: '1376px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalXXXL}`,
    boxSizing: 'border-box',
  },
  top: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalM, minHeight: '48px' },
  serviceNav: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: tokens.spacingHorizontalXS },
  utilities: { display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS, marginInlineStart: 'auto' },
  current: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ':hover': { backgroundColor: tokens.colorSubtleBackgroundSelected },
  },
  progress: {
    display: 'grid',
    gap: tokens.spacingVerticalXXS,
    width: '180px',
    maxWidth: '100%',
    '@media (max-width: 480px)': { width: '128px' },
  },
  titleArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    paddingTop: tokens.spacingVerticalXL,
  },
  workflowHeader: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalL,
  },
  workflowUtilities: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
  },
  titleText: { minWidth: 0, overflowWrap: 'anywhere' },
  heading: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    margin: 0,
    ':focus': { outline: 'none' },
  },
  subtle: { color: tokens.colorNeutralForeground3 },
  tabs: { marginInlineStart: `calc(${tokens.spacingHorizontalM} * -1)`, flexWrap: 'wrap' },
  content: { paddingTop: tokens.spacingVerticalXXL, paddingBottom: tokens.spacingVerticalXXXL },
  banner: { marginBottom: tokens.spacingVerticalL },
});

interface AppShellProps {
  readonly serviceName: string;
  readonly projectName: string;
  readonly compactTaskLayout?: CompactTaskLayoutSource;
}

const ProjectsPage = lazy(() => import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('../pages/ProjectsPage').then((m) => ({ default: m.ProjectDetailPage })));
const UsersPage = lazy(() => import('../pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const AssignmentsPage = lazy(() => import('../pages/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })));

const VIEWS: ReadonlyArray<{ value: ViewMode; icon: ReactElement }> = [
  { value: 'board', icon: <Board20Regular /> },
  { value: 'stage', icon: <TextBulletListLtr20Regular /> },
  { value: 'task', icon: <PanelLeft20Regular /> },
];

function selectShell(value: WorkflowContextValue) {
  const { process, state } = value;
  const progress = overallProgress(process, state);
  return {
    process,
    view: state.view,
    done: progress.done,
    total: progress.total,
    unlockedStage: frontStage(process, state),
    progressSignature: progressKey(state),
    dispatch: value.dispatch,
    persistence: value.persistence,
    reload: value.reload,
    workspace: value.workspace,
    openError: value.openError,
    readOnly: value.readOnly,
    permissionLost: value.permissionLost,
    conflictedDraftCount: Object.keys(value.conflictedDrafts ?? {}).length,
    saveAssignments: value.saveAssignments,
    assignmentsVersion: value.assignments?.version,
  };
}

export function AppShell({ serviceName, projectName, compactTaskLayout }: AppShellProps) {
  const styles = useStyles();
  const {
    process,
    view,
    done,
    total,
    unlockedStage,
    progressSignature,
    dispatch,
    persistence,
    reload,
    workspace,
    openError,
    readOnly,
    permissionLost,
    conflictedDraftCount,
    saveAssignments,
    assignmentsVersion,
  } = useWorkflowSelector(selectShell, shallowEqual);
  const projects = useProjects();
  const { t, st, locale } = useI18n();
  const { route, navigate } = useNavigation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const savedKey = `${workspace?.id ?? ''}:${progressSignature}:${assignmentsVersion ?? ''}`;
  const [workKey, setWorkKey] = useState(savedKey);
  if (persistence === 'saved' && workKey !== savedKey) setWorkKey(savedKey);
  const work = useMyWork(projects?.work, workKey);
  const readyCount = work.items?.filter((item) => item.group === 'ready').length ?? 0;
  const empty = persistence === 'empty';
  const projectArchived = !empty && workspace?.projectArchived === true;
  const available: Record<Route['page'], boolean> = {
    workflow: true,
    projects: Boolean(projects),
    project: Boolean(projects),
    users: Boolean(projects?.users),
    assignments: Boolean(!empty && workspace && saveAssignments && projects?.users),
    myWork: Boolean(projects?.work),
  };
  const page: Route = available[route.page] ? route : HOME;
  const menu = (target: Route, current: boolean) => ({
    onClick: () => navigate(target),
    ...(current ? { 'aria-current': 'page' as const, className: styles.current } : {}),
  });
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page.page);
  useEffect(() => {
    if (previousPage.current !== 'workflow' && page.page === 'workflow') headingRef.current?.focus();
    previousPage.current = page.page;
  }, [page.page]);
  const eyebrow = empty
    ? t.noWorkflowEyebrow
    : projects?.currentProject
      ? `${t.projectLabel} · ${projects.currentProject.name}`
      : t.projectLabel;
  const heading = empty ? t.noWorkflowTitle : projects && workspace?.name ? workspace.name : projectName;
  const openProjectsPanel = () => navigate({ page: 'projects' });
  const settingsOpenerRef = useRef<HTMLElement | null>(null);
  const onSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    if (!open && settingsOpenerRef.current?.isConnected) settingsOpenerRef.current.focus();
  };
  const toasterId = useId('toaster');
  const { dispatchToast } = useToastController(toasterId);

  const previousUnlocked = useRef(unlockedStage);
  useEffect(() => {
    if (unlockedStage > previousUnlocked.current) {
      const stage = getStage(process, unlockedStage);
      dispatchToast(
        <Toast>
          <ToastTitle>{t.stageOpenedTitle(stage.index + 1, st(stage).name)}</ToastTitle>
          <ToastBody>{t.stageOpenedBody(stage.tasks.length)}</ToastBody>
        </Toast>,
        { intent: 'success', timeout: 5000 },
      );
    }
    previousUnlocked.current = unlockedStage;
  }, [process, unlockedStage, dispatchToast, t, st]);

  const viewsId = useId('workflow-views');
  const panelId = `${viewsId}-panel`;
  const onTabSelect = (_: unknown, data: SelectTabData) => {
    if (isViewMode(data.value)) dispatch({ type: 'setView', view: data.value });
  };

  return (
    <div className={styles.root}>
      <header className={styles.bar}>
        <div className={`${styles.inner} ${styles.top}`}>
          <nav aria-label={t.serviceNavLabel} className={styles.serviceNav}>
            <Button
              appearance="subtle"
              onClick={() => {
                dispatch({ type: 'setView', view: 'board' });
                navigate(HOME);
              }}
              aria-label={`${serviceName} · ${t.home}`}
            >
              <Body1Strong>{serviceName}</Body1Strong>
            </Button>
            {projects && (
              <Button
                appearance="subtle"
                icon={<FolderOpen20Regular />}
                {...menu({ page: 'projects' }, page.page === 'projects' || page.page === 'project')}
              >
                {t.projects}
              </Button>
            )}
            {projects?.users && (
              <Button
                appearance="subtle"
                icon={<People20Regular />}
                {...menu({ page: 'users' }, page.page === 'users')}
              >
                {t.users}
              </Button>
            )}
          </nav>
          <div className={styles.utilities}>
            <AccountMenu
              {...(projects?.work
                ? {
                    myWork: {
                      readyCount,
                      onOpen: () => navigate({ page: 'myWork' }),
                      current: page.page === 'myWork',
                    },
                  }
                : {})}
              onPasswordChanged={() =>
                dispatchToast(
                  <Toast>
                    <ToastTitle>{t.passwordChanged}</ToastTitle>
                  </Toast>,
                  { intent: 'success', timeout: 5000 },
                )
              }
            />
            <Tooltip content={t.settings} relationship="label" withArrow>
              <Button
                appearance="subtle"
                icon={<Settings20Regular />}
                aria-haspopup="dialog"
                onClick={(event) => {
                  settingsOpenerRef.current = event.currentTarget;
                  setSettingsOpen(true);
                }}
              />
            </Tooltip>
          </div>
        </div>
      </header>

      {page.page !== 'workflow' ? (
        <Suspense fallback={<Spinner size="small" label={t.loading} className={styles.inner} />}>
          <main aria-label={pageLabel(page, t)}>
            {page.page === 'projects' && <ProjectsPage />}
            {page.page === 'project' && <ProjectDetailPage projectId={page.projectId} />}
            {page.page === 'users' && <UsersPage />}
            {page.page === 'assignments' && <AssignmentsPage />}
            {page.page === 'myWork' && <MyWorkPage work={work} />}
          </main>
        </Suspense>
      ) : (
        <main>
          <div className={styles.bar}>
            <div className={`${styles.inner} ${styles.titleArea}`}>
              <div className={styles.workflowHeader}>
                <div className={styles.titleText}>
                  <Caption1 className={styles.subtle}>{eyebrow}</Caption1>
                  <h1 ref={headingRef} tabIndex={-1} className={styles.heading}>
                    <Title3 block>{heading}</Title3>
                    {projectArchived && (
                      <Badge appearance="tint" color="subtle">
                        {t.badgeArchived}
                      </Badge>
                    )}
                  </h1>
                </div>
                {!empty && (
                  <div className={styles.workflowUtilities}>
                    <div className={styles.progress}>
                      <Caption1>{t.overallProgress(done, total)}</Caption1>
                      <ProgressBar value={total === 0 ? 0 : done / total} aria-label={t.overallProgressLabel} />
                    </div>
                    {available.assignments && (
                      <Button
                        appearance="secondary"
                        icon={<PersonAvailable20Regular />}
                        onClick={() => navigate({ page: 'assignments' })}
                      >
                        {t.assignments}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!empty && (
                <TabList
                  className={styles.tabs}
                  size="large"
                  selectedValue={view}
                  onTabSelect={onTabSelect}
                  aria-label={t.viewsLabel}
                >
                  {VIEWS.map((v) => (
                    <Tab
                      key={v.value}
                      value={v.value}
                      icon={v.icon}
                      id={`${viewsId}-${v.value}`}
                      aria-controls={panelId}
                    >
                      {t.views[v.value]}
                    </Tab>
                  ))}
                </TabList>
              )}
            </div>
          </div>

          {persistence === 'error' && openError ? (
            <OpenFailure className={styles.inner} kind={openError} onOpenProjects={openProjectsPanel} />
          ) : (
            persistence &&
            persistence !== 'empty' && (
              <div role={persistence === 'error' ? 'alert' : 'status'} className={styles.inner}>
                {locale === 'ko'
                  ? {
                      loading: '저장된 작업을 불러오는 중…',
                      saving: '저장 중… 완료될 때까지 페이지를 닫지 마세요.',
                      saved: '저장 완료',
                      error: '저장을 확인하지 못했습니다. 다시 불러오면 초안을 별도로 보관하고 최신 내용을 표시합니다.',
                    }[persistence]
                  : {
                      loading: 'Loading workflow…',
                      saving: 'Saving… Keep this page open until complete.',
                      saved: 'Saved',
                      error:
                        'Save could not be confirmed. Reload to keep your draft separately and view the latest saved content.',
                    }[persistence]}
                {persistence === 'error' && (
                  <Button
                    onClick={() => {
                      void reload?.();
                    }}
                  >
                    {locale === 'ko' ? '초안 보관하고 다시 불러오기' : 'Keep draft and reload'}
                  </Button>
                )}
                {conflictedDraftCount > 0 && (
                  <Button onClick={() => dispatch({ type: 'setView', view: 'task' })}>
                    {locale === 'ko'
                      ? `보관된 초안 ${conflictedDraftCount}개 확인`
                      : `Review ${conflictedDraftCount} recovered drafts`}
                  </Button>
                )}
              </div>
            )
          )}
          {empty ? (
            <div className={`${styles.inner} ${styles.content}`}>
              <NoWorkflow className={styles.banner} onOpenProjects={openProjectsPanel} />
              {projects?.work && (
                <section aria-labelledby="my-work-title">
                  <Subtitle2 as="h2" id="my-work-title" block>
                    {t.myWork}
                  </Subtitle2>
                  <MyWork work={work} />
                </section>
              )}
            </div>
          ) : (
            <div
              inert={persistence === 'loading'}
              role="tabpanel"
              id={panelId}
              aria-labelledby={`${viewsId}-${view}`}
              className={`${styles.inner} ${styles.content}`}
            >
              {permissionLost && (
                <MessageBar intent="warning" className={styles.banner}>
                  <MessageBarBody>{projectArchived ? t.permissionLostOnArchive : t.permissionLost}</MessageBarBody>
                </MessageBar>
              )}
              {readOnly && (
                <MessageBar intent="info" className={styles.banner}>
                  <MessageBarBody>{projectArchived ? t.archivedNotice : t.readOnlyNotice}</MessageBarBody>
                </MessageBar>
              )}
              {view !== 'task' && <ReworkBanner className={styles.banner} />}
              {view === 'stage' && <StageView />}
              {view === 'task' && <TaskView compactTaskLayout={compactTaskLayout} />}
              {view === 'board' && <BoardView />}
            </div>
          )}
        </main>
      )}

      <Toaster toasterId={toasterId} position="bottom-end" />
      <SettingsDrawer open={settingsOpen} onOpenChange={onSettingsOpenChange} />
      <OverrideDialog />
    </div>
  );
}

function pageLabel(route: Route, t: ReturnType<typeof useI18n>['t']): string {
  switch (route.page) {
    case 'workflow':
      return '';
    case 'projects':
    case 'project':
      return t.projects;
    case 'users':
      return t.users;
    case 'assignments':
      return t.assignments;
    case 'myWork':
      return t.myWork;
  }
}

function OpenFailure({
  className,
  kind,
  onOpenProjects,
}: {
  readonly className: string;
  readonly kind: RequestErrorKind;
  readonly onOpenProjects: () => void;
}) {
  const reload = useWorkflowSelector((value) => value.reload);
  const projects = useProjects();
  const { t } = useI18n();
  return (
    <div role="alert" className={className}>
      <MessageBar intent="error" layout="multiline">
        <MessageBarBody>{kind === 'notFound' ? t.workflowMissing : t.workflowOpenFailed}</MessageBarBody>
        <MessageBarActions>
          {projects && (
            <Button size="small" icon={<FolderOpen20Regular />} onClick={onOpenProjects}>
              {t.openProjectsPanel}
            </Button>
          )}
          {kind !== 'notFound' && (
            <Button
              size="small"
              onClick={() => {
                void reload?.();
              }}
            >
              {t.retry}
            </Button>
          )}
        </MessageBarActions>
      </MessageBar>
    </div>
  );
}

function NoWorkflow({
  className,
  onOpenProjects,
}: {
  readonly className: string;
  readonly onOpenProjects: () => void;
}) {
  const projects = useProjects();
  const process = useWorkflowSelector((value) => value.process);
  const { t } = useI18n();
  return (
    <section role="status" aria-label={t.noWorkflowTitle} className={className}>
      <MessageBar intent="info" layout="multiline">
        <MessageBarBody>
          {t.noWorkflowBody}
          <br />
          {t.workflowExplainer(process.stages.length, process.tasks.length)}
        </MessageBarBody>
        {projects && (
          <MessageBarActions>
            <Button appearance="primary" size="small" icon={<Add20Regular />} onClick={onOpenProjects}>
              {t.openProjectsPanel}
            </Button>
          </MessageBarActions>
        )}
      </MessageBar>
    </section>
  );
}
