import {
  RequestError,
  errorKindOf,
  planUserEdit,
  type UserManagement,
  type UserRepository,
} from '@process-flow/application';
import { createManagementQuery } from '../projects/managementQuery';

export function createUserManagement(repository: UserRepository): UserManagement {
  return {
    observeList: () => createManagementQuery((includeInactive) => repository.list(includeInactive)),
    create: async (input, context) => {
      if (!context.canManage) throw new RequestError('forbidden', 'User creation denied');
      return repository.create(input);
    },
    update: async (user, patch, context) => {
      const plan = planUserEdit(context, user.id, user.version, patch, '');
      if (plan.kind === 'denied') throw new RequestError(plan.error, 'User update denied');
      return repository.update(plan.metadata.userId, plan.metadata.expectedVersion, plan.metadata.patch);
    },
    edit: async (user, patch, password, context) => {
      const plan = planUserEdit(context, user.id, user.version, patch, password);
      if (plan.kind === 'denied') return { kind: 'failed', error: plan.error };
      let saved;
      try {
        saved = await repository.update(plan.metadata.userId, plan.metadata.expectedVersion, plan.metadata.patch);
      } catch (reason) {
        return { kind: 'failed', error: errorKindOf(reason) };
      }
      if (plan.password) {
        try {
          await repository.setPassword(plan.password.userId, plan.password.password);
        } catch (reason) {
          return { kind: 'passwordFailed', user: saved, error: errorKindOf(reason) };
        }
      }
      return { kind: 'saved', user: saved };
    },
  };
}
