import type { Role } from './access';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly active: boolean;
  readonly isAdmin: boolean;
  readonly version: number;
}

export interface Member {
  readonly role: Role;
  readonly user: User;
}
