import type { Member, Role, User } from '@process-flow/domain';

export interface UserInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
}
export interface UserPatch {
  readonly email?: string;
  readonly name?: string;
  readonly active?: boolean;
  readonly isAdmin?: boolean;
}

export interface UserRepository {
  list(includeInactive: boolean): Promise<readonly User[]>;
  create(input: UserInput): Promise<User>;
  update(id: string, expectedVersion: number, patch: UserPatch): Promise<User>;
  setPassword(id: string, password: string): Promise<void>;
  members(projectId: string): Promise<readonly Member[]>;
  putMember(projectId: string, userId: string, role: Role): Promise<Member>;
  removeMember(projectId: string, userId: string): Promise<void>;
}
