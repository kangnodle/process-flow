import { firstTaskOf, type Process, type TaskId } from '../process/model';
import { FINISHED, INITIAL_PHASE, working, type Phase } from './phase';

export type ViewMode = 'stage' | 'task' | 'board';

const DEFAULT_VIEW: ViewMode = 'board';
export const VIEW_MODES: readonly ViewMode[] = ['stage', 'task', 'board'];

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'stage' || value === 'task' || value === 'board';
}

export type ReviewStatus = 'pending' | 'passed' | 'blocked';

export interface TaskDocument {
  readonly version: 1;
  readonly answers: Readonly<Record<string, string>>;
  readonly reviewStatus: ReviewStatus;
}

interface EvidenceDetails {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface LinkEvidence extends EvidenceDetails {
  readonly kind: 'link';
  readonly url: string;
  readonly fileName?: never;
  readonly mediaType?: never;
  readonly size?: never;
  readonly base64?: never;
}

export interface FileEvidence extends EvidenceDetails {
  readonly kind: 'file';
  readonly url?: never;
  readonly fileName: string;
  readonly mediaType?: string;
  readonly size: number;
  readonly base64: string;
}

export type Evidence = LinkEvidence | FileEvidence;

export interface TaskRecord {
  readonly link: string;
  readonly note: string;
  readonly document?: TaskDocument;
  readonly evidence?: readonly Evidence[];
}

export const EMPTY_RECORD: TaskRecord = { link: '', note: '' };

export interface Rework {
  readonly untilNumber: number;
  readonly reason: string;
}

export interface WorkflowProgress {
  readonly phase: Phase;
  readonly rework: Rework | null;
  readonly records: Readonly<Record<TaskId, TaskRecord>>;
}

export interface WorkflowSelection {
  readonly view: ViewMode;
  readonly selectedTaskId: TaskId;
}

export interface WorkflowState extends WorkflowProgress, WorkflowSelection {}

export type WorkflowAction =
  | { readonly type: 'setView'; readonly view: ViewMode }
  | { readonly type: 'selectTask'; readonly taskId: TaskId; readonly view?: ViewMode }
  | { readonly type: 'completeTask'; readonly taskId: TaskId }
  | { readonly type: 'completeAndNext'; readonly taskId: TaskId }
  | { readonly type: 'reopenTask'; readonly taskId: TaskId }
  | { readonly type: 'approveStage'; readonly stageIndex: number }
  | { readonly type: 'requestRework'; readonly taskId: TaskId; readonly reason: string }
  | { readonly type: 'updateRecord'; readonly taskId: TaskId; readonly patch: Partial<TaskRecord> };

export function createInitialState(process: Process, view: ViewMode = DEFAULT_VIEW): WorkflowState {
  return { view, phase: INITIAL_PHASE, rework: null, selectedTaskId: firstTaskOf(process, 0).id, records: {} };
}

export function createDemoState(process: Process, view: ViewMode = DEFAULT_VIEW): WorkflowState {
  const single = process.lastStageIndex === 0;
  const phase = single ? FINISHED : working(1, 0);
  return { view, phase, rework: null, selectedTaskId: firstTaskOf(process, single ? 0 : 1).id, records: {} };
}
