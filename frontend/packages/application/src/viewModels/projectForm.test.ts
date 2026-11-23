import { expect, it } from 'vitest';
import { PROJECT_DESCRIPTION_MAX, PROJECT_NAME_MAX, hasIssues, projectFormIssues } from './projectForm';

it('이름은 앞뒤 공백을 빼고 1~100자, 설명은 2000자까지', () => {
  expect(projectFormIssues('   ', '')).toEqual({ name: 'required' });
  expect(projectFormIssues('가'.repeat(PROJECT_NAME_MAX), '')).toEqual({});
  expect(projectFormIssues(` ${'가'.repeat(PROJECT_NAME_MAX + 1)} `, '')).toEqual({ name: 'tooLong' });
  expect(projectFormIssues('😀'.repeat(PROJECT_NAME_MAX), '')).toEqual({});
  expect(projectFormIssues('a', 'b'.repeat(PROJECT_DESCRIPTION_MAX + 1))).toEqual({ description: 'tooLong' });
  expect(hasIssues(projectFormIssues('결제', ''))).toBe(false);
});
