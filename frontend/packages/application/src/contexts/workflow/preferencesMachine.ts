import type { WorkspacePreferences } from '../../ports';

export type PreferencesState =
  | { readonly kind: 'idle'; readonly sequence: number }
  | {
      readonly kind: 'saving';
      readonly sequence: number;
      readonly patch: WorkspacePreferences;
      readonly pending: WorkspacePreferences;
    }
  | {
      readonly kind: 'failed';
      readonly sequence: number;
      readonly patch: WorkspacePreferences;
      readonly error: string;
    };
export type PreferencesEvent =
  | { readonly type: 'change'; readonly patch: WorkspacePreferences }
  | { readonly type: 'retry' }
  | { readonly type: 'stop' }
  | { readonly type: 'saved'; readonly request: number }
  | { readonly type: 'failed'; readonly request: number; readonly error: string };

export interface PreferencesEffect {
  readonly request: number;
  readonly patch: WorkspacePreferences;
}

export function transitionPreferences(
  state: PreferencesState,
  event: PreferencesEvent,
): { readonly state: PreferencesState; readonly effects: readonly PreferencesEffect[] } {
  const unchanged = { state, effects: [] };
  if (event.type === 'stop') {
    if (state.kind === 'idle') return { state: { ...state, sequence: state.sequence + 1 }, effects: [] };
    return {
      state: {
        kind: 'failed',
        sequence: state.sequence + 1,
        patch: { ...state.patch, ...(state.kind === 'saving' ? state.pending : {}) },
        error: 'Settings saving was interrupted.',
      },
      effects: [],
    };
  }
  if (event.type === 'change' && !Object.keys(event.patch).length) return unchanged;
  if (event.type === 'change' || event.type === 'retry') {
    if (event.type === 'retry' && state.kind !== 'failed') return unchanged;
    const patch = event.type === 'change' ? event.patch : {};
    if (state.kind === 'saving') return { state: { ...state, pending: { ...state.pending, ...patch } }, effects: [] };
    const next = { ...(state.kind === 'failed' ? state.patch : {}), ...patch };
    const request = state.sequence + 1;
    return {
      state: { kind: 'saving', sequence: request, patch: next, pending: {} },
      effects: [{ request, patch: next }],
    };
  }
  if (state.kind !== 'saving' || state.sequence !== event.request) return unchanged;
  if (event.type === 'failed')
    return {
      state: {
        kind: 'failed',
        sequence: state.sequence,
        patch: { ...state.patch, ...state.pending },
        error: event.error,
      },
      effects: [],
    };
  if (!Object.keys(state.pending).length) return { state: { kind: 'idle', sequence: state.sequence }, effects: [] };
  const request = state.sequence + 1;
  return {
    state: { kind: 'saving', sequence: request, patch: state.pending, pending: {} },
    effects: [{ request, patch: state.pending }],
  };
}
