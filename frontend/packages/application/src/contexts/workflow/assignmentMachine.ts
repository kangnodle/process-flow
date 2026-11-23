import type { Assignments, AssignmentsInput } from '@process-flow/domain';
import type { RequestErrorKind } from '../../errors';
import type { SavedWorkflow } from '../../ports';

export type AssignmentSaveState =
  | { readonly kind: 'idle'; readonly sequence: number }
  | { readonly kind: 'saving'; readonly sequence: number; readonly workflowId: string }
  | { readonly kind: 'saved'; readonly sequence: number; readonly assignments: Assignments }
  | { readonly kind: 'failed'; readonly sequence: number; readonly error: RequestErrorKind };
export type AssignmentSaveEvent =
  | {
      readonly type: 'save';
      readonly input: AssignmentsInput;
      readonly saved: SavedWorkflow | undefined;
      readonly pendingChanges: boolean;
      readonly available: boolean;
    }
  | { readonly type: 'saved'; readonly request: number; readonly assignments: Assignments }
  | { readonly type: 'failed'; readonly request: number; readonly error: RequestErrorKind }
  | { readonly type: 'stop' };
export interface AssignmentSaveEffect {
  readonly request: number;
  readonly id: string;
  readonly expectedVersion: number;
  readonly input: AssignmentsInput;
}
export interface AssignmentTransition {
  readonly state: AssignmentSaveState;
  readonly effects: readonly AssignmentSaveEffect[];
  readonly rejected?: RequestErrorKind;
}

export function transitionAssignments(state: AssignmentSaveState, event: AssignmentSaveEvent): AssignmentTransition {
  if (event.type === 'stop') return { state: { kind: 'idle', sequence: state.sequence + 1 }, effects: [] };
  if (event.type === 'save') {
    if (state.kind === 'saving') return { state, effects: [], rejected: 'conflict' };
    const error =
      !event.saved || event.pendingChanges
        ? 'conflict'
        : !event.available || !(event.saved.permissions?.includes('assignments.manage') ?? true)
          ? 'forbidden'
          : undefined;
    if (error || !event.saved)
      return {
        state: { kind: 'failed', sequence: state.sequence, error: error ?? 'conflict' },
        effects: [],
        rejected: error ?? 'conflict',
      };
    const request = state.sequence + 1;
    return {
      state: { kind: 'saving', sequence: request, workflowId: event.saved.id },
      effects: [
        { request, id: event.saved.id, expectedVersion: event.saved.assignments?.version ?? 0, input: event.input },
      ],
    };
  }
  if (state.kind !== 'saving' || state.sequence !== event.request) return { state, effects: [] };
  return {
    state:
      event.type === 'saved'
        ? { kind: 'saved', sequence: state.sequence, assignments: event.assignments }
        : { kind: 'failed', sequence: state.sequence, error: event.error },
    effects: [],
  };
}
