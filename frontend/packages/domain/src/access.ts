export const PERMISSIONS = [
  'project.view',
  'workflow.start',
  'workflow.execute',
  'preferences.save',
  'project.edit',
  'members.manage',
  'assignments.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const isPermission = (value: unknown): value is Permission => PERMISSIONS.includes(value as Permission);

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const isRole = (value: unknown): value is Role => ROLES.includes(value as Role);
