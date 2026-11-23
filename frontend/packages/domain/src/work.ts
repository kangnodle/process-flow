export const WORK_GROUPS = ['ready', 'waiting', 'open', 'watching'] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export const WORK_KINDS = ['task', 'approval', 'consulted', 'informed'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
export type WorkWait = { readonly kind: 'afterTasks'; readonly remaining: number } | { readonly kind: 'stageLocked' };
export interface WorkItem {
  readonly projectId: string;
  readonly projectName: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly group: WorkGroup;
  readonly kind: WorkKind;
  readonly stageId: string;
  readonly stageIndex: number;
  readonly taskId?: string;
  readonly taskNumber?: number;
  readonly wait?: WorkWait;
  readonly rework: boolean;
}
