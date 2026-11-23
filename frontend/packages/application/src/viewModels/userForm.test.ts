import { expect, it } from 'vitest';
import { PASSWORD_MAX, USER_NAME_MAX, isValidEmail, isValidPassword, normalizeEmail, userFormIssues } from './userForm';

it('이메일은 서버와 같은 모양 규칙으로 검사한다', () => {
  expect(normalizeEmail('  Kim@Example.COM ')).toBe('kim@example.com');
  expect(isValidEmail(' Kim@Example.com ')).toBe(true);
  for (const bad of [
    '',
    'kim',
    '@example.com',
    'kim@',
    'kim@example',
    'kim@@example.com',
    'k im@example.com',
    'kim@.com',
  ]) {
    expect(isValidEmail(bad), bad).toBe(false);
  }
});

it('이름은 1~100자', () => {
  expect(userFormIssues('a@b.co', ' ')).toEqual({ name: 'required' });
  expect(userFormIssues('a@b.co', '가'.repeat(USER_NAME_MAX + 1))).toEqual({ name: 'tooLong' });
  expect(userFormIssues('nope', '김')).toEqual({ email: 'invalid' });
  expect(userFormIssues('a@b.co', '김')).toEqual({});
});

it('비밀번호는 8~128자', () => {
  expect(isValidPassword('1234567')).toBe(false);
  expect(isValidPassword('12345678')).toBe(true);
  expect(isValidPassword('가'.repeat(PASSWORD_MAX + 1))).toBe(false);
});
