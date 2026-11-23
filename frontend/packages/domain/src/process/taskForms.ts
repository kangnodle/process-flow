import type { Locale } from '../locale';
import type { TaskRecord } from '../workflow/state';
import catalog from './task-forms.json';
import type { StandardTaskId } from './standard';

export interface TaskField {
  readonly id: string;
  readonly label: Readonly<Record<Locale, string>>;
  readonly hint: Readonly<Record<Locale, string>>;
  readonly allowNotApplicable?: boolean;
}

const forms: Readonly<Record<string, readonly TaskField[]>> = catalog satisfies Record<
  StandardTaskId,
  readonly TaskField[]
>;
export function taskForm(taskId: string): readonly TaskField[] {
  return Object.hasOwn(forms, taskId) ? forms[taskId]! : [];
}

const placeholders = new Set([
  'tbd',
  'todo',
  'pending',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  '미정',
  '추후',
  '작성 예정',
  '해당 없음',
  '없음',
]);
function meaningful(value: unknown, allowNotApplicable = false): boolean {
  if (typeof value !== 'string') return false;
  const answer = value.trim();
  if (!/[\p{L}\p{N}]/u.test(answer) || placeholders.has(answer.toLowerCase())) return false;
  const notApplicable = /^(?:n\/a|해당 없음)\s*[:：-]\s*(.*)$/iu.exec(answer);
  return notApplicable ? allowNotApplicable && meaningful(notApplicable[1]) : true;
}

export function validateTaskDocument(taskId: string, record: TaskRecord): readonly string[] {
  const fields = taskForm(taskId);
  if (!fields.length) return [];
  const document = record.document;
  const invalid = fields
    .filter((field) => document?.version !== 1 || !meaningful(document.answers?.[field.id], field.allowNotApplicable))
    .map((field) => field.id);
  if (document?.reviewStatus !== 'passed') invalid.push('reviewStatus');
  return invalid;
}
