export interface StageAssignment {
  readonly stageId: string;
  readonly accountable?: string;
  readonly responsible: readonly string[];
  readonly consulted: readonly string[];
  readonly informed: readonly string[];
}
export interface TaskAssignment {
  readonly taskId: string;
  readonly responsible: readonly string[];
}
export interface Assignments {
  readonly version: number;
  readonly stages: readonly StageAssignment[];
  readonly tasks: readonly TaskAssignment[];
}
export type AssignmentsInput = Omit<Assignments, 'version'>;
export const NO_ASSIGNMENTS: Assignments = { version: 0, stages: [], tasks: [] };

export const AUTHORITIES = ['assigned', 'open', 'override'] as const;
export type Authority = (typeof AUTHORITIES)[number];
export const isAuthority = (value: unknown): value is Authority => AUTHORITIES.includes(value as Authority);
export interface WorkflowAuthority {
  readonly tasks: Readonly<Record<string, Authority | null>>;
  readonly stages: Readonly<Record<string, Authority | null>>;
}
