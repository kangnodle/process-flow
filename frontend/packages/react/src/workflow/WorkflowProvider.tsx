import {
  actionTarget,
  assigneesOf,
  authorityOf,
  blockOf,
  createInitialState,
  createWorkflowReducer,
  type Process,
  type TaskId,
  targetKey,
  type WorkflowAction,
  type WorkflowState,
} from '@process-flow/domain';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import type { Scheduler, WorkflowFocus, WorkflowRepository } from '@process-flow/application';
import { WorkflowSession } from '@process-flow/runtime';
import { WorkflowContext, WorkflowStoreContext, type WorkflowContextValue, useWorkflowStore } from './workflowContext';

interface WorkflowProviderProps {
  readonly process: Process;
  readonly repository?: WorkflowRepository;
  readonly scheduler: Scheduler;
  readonly guardUnsaved?: (isUnsaved: () => boolean) => () => void;
  readonly children: ReactNode;
  readonly initialState?: WorkflowState;
  readonly initialFocus?: WorkflowFocus;
}

export function WorkflowProvider(props: WorkflowProviderProps) {
  return props.repository ? (
    <PersistentWorkflowProvider {...props} repository={props.repository} />
  ) : (
    <LocalWorkflowProvider {...props} />
  );
}
function PersistentWorkflowProvider({
  process,
  repository,
  scheduler,
  children,
  guardUnsaved,
  initialFocus,
}: WorkflowProviderProps & { repository: WorkflowRepository }) {
  const [session] = useState(() => new WorkflowSession(process, repository, scheduler, initialFocus));
  useEffect(
    () =>
      guardUnsaved?.(() => {
        const current = session.getSnapshot();
        return current.hasUnsavedChanges || Object.keys(current.conflictedDrafts ?? {}).length > 0;
      }),
    [guardUnsaved, session],
  );
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const flush = useCallback(() => session.flush().then(() => !session.getSnapshot().hasUnsavedChanges), [session]);
  const canSwitchWorkflow = useCallback(() => {
    const current = session.getSnapshot();
    return (
      current.status !== 'loading' &&
      !current.hasUnsavedChanges &&
      Object.keys(current.conflictedDrafts ?? {}).length === 0
    );
  }, [session]);
  useEffect(() => {
    void session.open();
    return session.stop;
  }, [session]);

  const [pending, setPending] = useState<WorkflowAction>();
  const [confirmed] = useState(() => new Set<string>());
  const dispatch = useCallback(
    (action: WorkflowAction) => {
      const target = actionTarget(process, action);
      const { authority, status } = session.getSnapshot();
      const overriding = authorityOf(process, authority, action) === 'override';
      if (target && overriding && status !== 'error' && !confirmed.has(targetKey(target))) {
        setPending(action);
        return;
      }
      session.dispatch(action);
    },
    [process, session, confirmed],
  );
  const restoreDraft = useCallback((taskId: TaskId) => session.restoreDraft(taskId, dispatch), [session, dispatch]);
  const confirmOverride = useCallback(() => {
    if (!pending) return;
    const target = actionTarget(process, pending);
    if (target) confirmed.add(targetKey(target));
    setPending(undefined);
    session.dispatch(pending);
  }, [process, session, confirmed, pending]);
  const cancelOverride = useCallback(() => setPending(undefined), []);

  const { readOnly, authority, assignments } = snapshot;
  const block = useCallback(
    (action: WorkflowAction) => blockOf(process, { readOnly, authority, assignments }, action),
    [process, readOnly, authority, assignments],
  );
  const hasSaveAssignments = Boolean(repository.saveAssignments);
  const value = useMemo<WorkflowContextValue>(
    () => ({
      process,
      state: snapshot.state,
      dispatch,
      blockOf: block,
      ...(pending
        ? { pendingOverride: { action: pending, assignees: assigneesOf(process, snapshot.assignments, pending) } }
        : {}),
      confirmOverride,
      cancelOverride,
      persistence: snapshot.status,
      hasUnsavedChanges: snapshot.hasUnsavedChanges,
      readOnly: snapshot.readOnly,
      ...(snapshot.permissions ? { permissions: snapshot.permissions } : {}),
      ...(snapshot.assignments ? { assignments: snapshot.assignments } : {}),
      ...(hasSaveAssignments ? { saveAssignments: session.saveAssignments } : {}),
      ...(snapshot.permissionLost ? { permissionLost: true } : {}),
      ...(snapshot.openError ? { openError: snapshot.openError } : {}),
      reload: session.reload,
      restoreDraft,
      canSwitchWorkflow,
      ...(snapshot.conflictedDrafts ? { conflictedDrafts: snapshot.conflictedDrafts } : {}),
      ...(snapshot.preferences ? { remotePreferences: snapshot.preferences } : {}),
      ...(snapshot.workspace ? { workspace: snapshot.workspace } : {}),
      flush,
      savePreferences: session.savePreferences,
      ...(snapshot.preferenceError ? { preferenceError: snapshot.preferenceError } : {}),
      retryPreferences: session.retryPreferences,
      ...(snapshot.preferencesLoadError ? { preferencesLoadError: snapshot.preferencesLoadError } : {}),
      retryPreferenceLoad: session.refresh,
    }),
    [
      process,
      snapshot,
      dispatch,
      block,
      pending,
      confirmOverride,
      cancelOverride,
      hasSaveAssignments,
      session,
      flush,
      restoreDraft,
      canSwitchWorkflow,
    ],
  );
  const store = useWorkflowStore(value);
  return (
    <WorkflowStoreContext.Provider value={store}>
      <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
    </WorkflowStoreContext.Provider>
  );
}
const NEVER_BLOCKED = () => null;
function LocalWorkflowProvider({ process, initialState, children }: WorkflowProviderProps) {
  const reducer = useMemo(() => createWorkflowReducer(process), [process]);
  const [state, dispatch] = useReducer(reducer, initialState ?? createInitialState(process));
  const value = useMemo<WorkflowContextValue>(
    () => ({ process, state, dispatch, blockOf: NEVER_BLOCKED }),
    [process, state],
  );
  const store = useWorkflowStore(value);
  return (
    <WorkflowStoreContext.Provider value={store}>
      <WorkflowContext.Provider value={value}>{children}</WorkflowContext.Provider>
    </WorkflowStoreContext.Provider>
  );
}
