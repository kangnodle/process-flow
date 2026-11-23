import type {
  ActionBlock,
  Assignments,
  AssignmentsInput,
  Permission,
  Process,
  StoredPreferences,
  TaskId,
  TaskRecord,
  WorkflowAction,
  WorkflowState,
} from '@process-flow/domain';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
} from 'react';
import type { RequestErrorKind } from '@process-flow/application';
import type { WorkspaceIdentity } from '@process-flow/runtime';

export interface WorkflowContextValue {
  readonly process: Process;
  readonly persistence?: 'loading' | 'empty' | 'saving' | 'saved' | 'error';
  readonly reload?: () => Promise<void>;
  readonly conflictedDrafts?: Readonly<Record<TaskId, TaskRecord>>;
  readonly restoreDraft?: (taskId: TaskId) => void;
  readonly canSwitchWorkflow?: () => boolean;
  readonly hasUnsavedChanges?: boolean;
  readonly readOnly?: boolean;
  readonly permissionLost?: boolean;
  readonly openError?: RequestErrorKind;
  readonly remotePreferences?: Partial<StoredPreferences>;
  readonly savePreferences?: (patch: Partial<StoredPreferences>) => void;
  readonly preferenceError?: string;
  readonly retryPreferences?: () => Promise<void>;
  readonly preferencesLoadError?: string;
  readonly retryPreferenceLoad?: () => Promise<void>;
  readonly workspace?: WorkspaceIdentity;
  readonly flush?: () => Promise<boolean>;
  readonly permissions?: readonly Permission[];
  readonly assignments?: Assignments;
  readonly saveAssignments?: (input: AssignmentsInput) => Promise<void>;
  readonly blockOf: (action: WorkflowAction) => ActionBlock | null;
  readonly pendingOverride?: { readonly action: WorkflowAction; readonly assignees: readonly string[] };
  readonly confirmOverride?: () => void;
  readonly cancelOverride?: () => void;
  readonly state: WorkflowState;
  readonly dispatch: Dispatch<WorkflowAction>;
}

export const WorkflowContext = createContext<WorkflowContextValue | null>(null);

export function useWorkflow(): WorkflowContextValue {
  const value = useContext(WorkflowContext);
  if (!value) {
    throw new Error('useWorkflow는 <WorkflowProvider> 안에서만 사용할 수 있습니다.');
  }
  return value;
}

export interface WorkflowStore {
  readonly get: () => WorkflowContextValue;
  readonly subscribe: (listener: () => void) => () => void;
}

export const WorkflowStoreContext = createContext<WorkflowStore | null>(null);

export function useWorkflowStore(value: WorkflowContextValue): WorkflowStore {
  const [store] = useState(() => {
    let current = value;
    const listeners = new Set<() => void>();
    return {
      get: () => current,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set: (next: WorkflowContextValue) => {
        if (next === current) return;
        current = next;
        listeners.forEach((listener) => listener());
      },
    };
  });
  useLayoutEffect(() => store.set(value), [store, value]);
  return store;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

export function useWorkflowSelector<T>(
  selector: (value: WorkflowContextValue) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useContext(WorkflowStoreContext);
  if (!store) {
    throw new Error('useWorkflowSelector는 <WorkflowProvider> 안에서만 사용할 수 있습니다.');
  }
  const cache = useRef<{
    source: WorkflowContextValue;
    selector: typeof selector;
    isEqual: typeof isEqual;
    selected: T;
  } | null>(null);
  const getSnapshot = () => {
    const source = store.get();
    const cached = cache.current;
    if (cached && cached.source === source && cached.selector === selector && cached.isEqual === isEqual)
      return cached.selected;
    const selected = selector(source);
    const kept = cached && isEqual(cached.selected, selected) ? cached.selected : selected;
    cache.current = { source, selector, isEqual, selected: kept };
    return kept;
  };
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
