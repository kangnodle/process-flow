import {
  RequestError,
  planMemberOperation,
  type MemberManagement,
  type UserRepository,
} from '@process-flow/application';
import { createManagementQuery } from '../projects/managementQuery';

export function createMemberManagement(repository: UserRepository): MemberManagement {
  return {
    observeDirectory: () =>
      createManagementQuery(async (projectId) => {
        const [members, candidates] = await Promise.all([repository.members(projectId), repository.list(false)]);
        return { members, candidates };
      }),
    observeCurrent: () => createManagementQuery(async (projectId) => (projectId ? repository.members(projectId) : [])),
    put: async (context, userId, role) => {
      const plan = planMemberOperation(context, { kind: 'put', userId, role });
      if (plan.kind !== 'put') throw new RequestError('forbidden', 'Member update denied');
      return repository.putMember(plan.projectId, plan.userId, plan.role);
    },
    remove: async (context, userId) => {
      const plan = planMemberOperation(context, { kind: 'remove', userId });
      if (plan.kind !== 'remove') throw new RequestError('forbidden', 'Member removal denied');
      await repository.removeMember(plan.projectId, plan.userId);
    },
  };
}
