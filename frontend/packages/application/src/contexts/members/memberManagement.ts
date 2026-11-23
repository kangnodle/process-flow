import type { Member, Role, User } from '@process-flow/domain';
import type { ManagementQuery } from '../projects/managementQuery';

export interface MemberManagementContext {
  readonly projectId: string;
  readonly canManage: boolean;
}
export interface MemberDirectory {
  readonly members: readonly Member[];
  readonly candidates: readonly User[];
}
export type MemberMutation =
  | { readonly kind: 'put'; readonly userId: string; readonly role: Role }
  | { readonly kind: 'remove'; readonly userId: string };
export type MemberOperationPlan =
  | { readonly kind: 'denied'; readonly error: 'forbidden' }
  | (MemberMutation & { readonly projectId: string });
export const planMemberOperation = (
  context: MemberManagementContext,
  operation: MemberMutation,
): MemberOperationPlan =>
  context.canManage ? { ...operation, projectId: context.projectId } : { kind: 'denied', error: 'forbidden' };

export interface MemberManagement {
  observeDirectory(): ManagementQuery<string, MemberDirectory>;
  observeCurrent(): ManagementQuery<string | undefined, readonly Member[]>;
  put(context: MemberManagementContext, userId: string, role: Role): Promise<Member>;
  remove(context: MemberManagementContext, userId: string): Promise<void>;
}
