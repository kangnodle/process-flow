export const USER_NAME_MAX = 100;
export const EMAIL_MAX = 254;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export function isValidPassword(password: string): boolean {
  const length = Array.from(password).length;
  return length >= PASSWORD_MIN && length <= PASSWORD_MAX;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  if (Array.from(value).length > EMAIL_MAX || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at <= 0 || value.indexOf('@', at + 1) !== -1) return false;
  const labels = value.slice(at + 1).split('.');
  return labels.length >= 2 && labels.every((label) => label.length > 0);
}

export interface UserFormIssues {
  readonly email?: 'invalid';
  readonly name?: 'required' | 'tooLong';
}

export function userFormIssues(email: string, name: string): UserFormIssues {
  const nameLength = Array.from(name.trim()).length;
  return {
    ...(isValidEmail(email) ? {} : { email: 'invalid' as const }),
    ...(nameLength === 0
      ? { name: 'required' as const }
      : nameLength > USER_NAME_MAX
        ? { name: 'tooLong' as const }
        : {}),
  };
}
