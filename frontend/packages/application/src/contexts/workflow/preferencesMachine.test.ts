import { expect, it } from 'vitest';
import { transitionPreferences, type PreferencesState } from './preferencesMachine';

it('preserves a failed patch and retries it with newer fields winning', () => {
  const idle: PreferencesState = { kind: 'idle', sequence: 0 };
  const sending = transitionPreferences(idle, { type: 'change', patch: { locale: 'en' } });
  const changed = transitionPreferences(sending.state, { type: 'change', patch: { theme: 'dark', locale: 'ko' } });
  const failed = transitionPreferences(changed.state, { type: 'failed', request: 1, error: 'offline' });
  expect(failed.state).toMatchObject({ kind: 'failed', patch: { locale: 'ko', theme: 'dark' }, error: 'offline' });
  const retry = transitionPreferences(failed.state, { type: 'retry' });
  expect(retry.effects).toEqual([{ request: 2, patch: { locale: 'ko', theme: 'dark' } }]);
  expect(transitionPreferences(retry.state, { type: 'saved', request: 1 }).state).toBe(retry.state);
});
