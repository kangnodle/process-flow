import type { User } from '@process-flow/domain';
import type { RequestErrorKind } from '../../errors';
import type { UserInput, UserPatch } from '../../ports/userRepository';
import type { ManagementQuery } from '../projects/managementQuery';

export interface UserManagementContext {
  readonly canManage: boolean;
}

export type UserEditPlan =
  | { readonly kind: 'denied'; readonly error: 'forbidden' }
  | {
      readonly kind: 'edit';
      readonly metadata: { readonly userId: string; readonly expectedVersion: number; readonly patch: UserPatch };
      readonly password?: { readonly userId: string; readonly password: string };
    };

export function planUserEdit(
  context: UserManagementContext,
  userId: string,
  expectedVersion: number,
  patch: UserPatch,
  password: string,
): UserEditPlan {
  if (!context.canManage) return { kind: 'denied', error: 'forbidden' };
  return {
    kind: 'edit',
    metadata: { userId, expectedVersion, patch },
    ...(password ? { password: { userId, password } } : {}),
  };
}

export type UserEditResult =
  | { readonly kind: 'saved'; readonly user: User }
  | { readonly kind: 'passwordFailed'; readonly user: User; readonly error: RequestErrorKind }
  | { readonly kind: 'failed'; readonly error: RequestErrorKind };

export interface UserManagement {
  observeList(): ManagementQuery<boolean, readonly User[]>;
  create(input: UserInput, context: UserManagementContext): Promise<User>;
  update(user: User, patch: UserPatch, context: UserManagementContext): Promise<User>;
  edit(user: User, patch: UserPatch, password: string, context: UserManagementContext): Promise<UserEditResult>;
}
