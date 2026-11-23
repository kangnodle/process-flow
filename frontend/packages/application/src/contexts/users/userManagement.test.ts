import { describe, expect, it } from 'vitest';
import { planUserEdit } from './userManagement';

describe('user edit plan', () => {
  it('describes metadata followed by an optional password operation without changing input', () => {
    const patch = Object.freeze({ name: 'Saved' });
    expect(planUserEdit({ canManage: true }, 'user', 2, patch, 'new-password')).toEqual({
      kind: 'edit',
      metadata: { userId: 'user', expectedVersion: 2, patch },
      password: { userId: 'user', password: 'new-password' },
    });
    expect(planUserEdit({ canManage: true }, 'user', 2, patch, '')).toEqual({
      kind: 'edit',
      metadata: { userId: 'user', expectedVersion: 2, patch },
    });
    expect(patch).toEqual({ name: 'Saved' });
  });
  it('represents denied changes without executable operations', () => {
    expect(planUserEdit({ canManage: false }, 'user', 2, {}, 'secret')).toEqual({ kind: 'denied', error: 'forbidden' });
  });
});
