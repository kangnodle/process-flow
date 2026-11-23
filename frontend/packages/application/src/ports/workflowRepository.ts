import type {
  Assignments,
  AssignmentsInput,
  Locale,
  Permission,
  PersistentAction,
  TaskId,
  ThemePreference,
  ViewMode,
  WorkflowAuthority,
  WorkflowState,
} from '@process-flow/domain';

export interface WorkspacePreferences {
  readonly locale?: Locale;
  readonly theme?: ThemePreference;
  readonly view?: ViewMode;
  readonly selectedTaskId?: TaskId;
}

export interface SavedWorkflow {
  readonly id: string;
  readonly name?: string;
  readonly projectId?: string;
  readonly projectArchived?: boolean;
  readonly version: number;
  readonly state: WorkflowState;
  readonly preferences?: WorkspacePreferences;
  readonly preferencesLoadError?: string;
  readonly permissions?: readonly Permission[];
  readonly assignments?: Assignments;
  readonly authority?: WorkflowAuthority;
}

export interface WorkflowFocus {
  readonly taskId: string;
  readonly view: ViewMode;
}

export interface WorkflowRepository {
  open(): Promise<SavedWorkflow | undefined>;
  execute(id: string, version: number, command: PersistentAction): Promise<SavedWorkflow>;
  savePreferences?(id: string, patch: WorkspacePreferences): Promise<WorkspacePreferences>;
  switchTo?(id: string | undefined): void;
  saveAssignments?(id: string, expectedVersion: number, input: AssignmentsInput): Promise<Assignments>;
}
