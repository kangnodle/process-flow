import { describe, expect, it } from 'vitest';
import * as domain from '../index';

const validRecord = (taskId: string) => ({
  link: '',
  note: '',
  document: {
    version: 1 as const,
    reviewStatus: 'passed' as const,
    answers: Object.fromEntries(
      domain
        .taskForm(taskId)
        .map((field) => [field.id, `Confirmed ${field.id}: customer interviews and agreed decision.`]),
    ),
  },
});

describe('task document catalog and gates', () => {
  it('defines bilingual required forms for all 25 tasks with separate structured requirements', () => {
    expect(typeof domain.taskForm).toBe('function');
    for (const task of domain.STANDARD_PROCESS.tasks) {
      const fields = domain.taskForm(task.id);
      expect(fields.length).toBeGreaterThanOrEqual(3);
      expect(new Set(fields.map((f) => f.id)).size).toBe(fields.length);
      fields.forEach((f) =>
        ['ko', 'en'].forEach((locale) => {
          expect(f.label[locale as 'ko' | 'en'].trim()).not.toBe('');
          expect(f.hint[locale as 'ko' | 'en'].trim()).not.toBe('');
        }),
      );
    }
    expect(domain.taskForm('goals').map((f) => f.id)).toEqual(
      expect.arrayContaining(['kpi-name', 'kpi-target', 'kpi-method', 'scope-in', 'scope-out']),
    );
  });
  it('rejects empty or evidence-only completion and allows complete reviewed answers without evidence', () => {
    const initial = domain.createInitialState(domain.STANDARD_PROCESS);
    const reduce = domain.createWorkflowReducer(domain.STANDARD_PROCESS);
    expect(reduce(initial, { type: 'completeTask', taskId: 'goals' })).toBe(initial);
    const evidenceOnly = reduce(initial, {
      type: 'updateRecord',
      taskId: 'goals',
      patch: {
        evidence: [
          { id: 'link1', kind: 'link', title: 'Report', description: 'Interview results', url: 'https://example.com' },
        ],
      },
    });
    expect(reduce(evidenceOnly, { type: 'completeTask', taskId: 'goals' })).toBe(evidenceOnly);
    const ready = reduce(initial, { type: 'updateRecord', taskId: 'goals', patch: validRecord('goals') });
    expect(reduce(ready, { type: 'completeTask', taskId: 'goals' }).phase).toEqual(domain.working(0, 1));
  });
  it('requires each field, version one and passed review; placeholders cannot satisfy content', () => {
    expect(typeof domain.validateTaskDocument).toBe('function');
    const record = validRecord('goals');
    expect(domain.validateTaskDocument('goals', record)).toEqual([]);
    for (const value of ['', '   ', '...', 'TBD', 'TODO', 'N/A', 'N/A: no reason to do this', '미정', '해당 없음']) {
      const partial = {
        ...record,
        document: { ...record.document, answers: { ...record.document.answers, 'kpi-target': value } },
      };
      expect(domain.validateTaskDocument('goals', partial)).toContain('kpi-target');
    }
    for (const reviewStatus of ['pending', 'blocked'] as const)
      expect(
        domain.validateTaskDocument('goals', { ...record, document: { ...record.document, reviewStatus } }),
      ).toEqual(['reviewStatus']);
  });
  it('freezes completed and locked records, and reopens completed records for edits', () => {
    const reduce = domain.createWorkflowReducer(domain.STANDARD_PROCESS);
    const ready = reduce(domain.createInitialState(domain.STANDARD_PROCESS), {
      type: 'updateRecord',
      taskId: 'goals',
      patch: validRecord('goals'),
    });
    const done = reduce(ready, { type: 'completeTask', taskId: 'goals' });
    expect(reduce(done, { type: 'updateRecord', taskId: 'goals', patch: { note: 'overwrite' } })).toBe(done);
    expect(reduce(done, { type: 'updateRecord', taskId: 'wireframes', patch: { note: 'locked' } })).toBe(done);
    const reopened = reduce(done, { type: 'reopenTask', taskId: 'goals' });
    expect(
      reduce(reopened, { type: 'updateRecord', taskId: 'goals', patch: { note: 'revision' } }).records.goals?.note,
    ).toBe('revision');
  });
  it('rejects approval of legacy completed records', () => {
    const state = { ...domain.createInitialState(domain.STANDARD_PROCESS), phase: domain.awaitingApproval(0) };
    expect(domain.createWorkflowReducer(domain.STANDARD_PROCESS)(state, { type: 'approveStage', stageIndex: 0 })).toBe(
      state,
    );
  });
});

it('invalidates prior review after a note or evidence revision and rejects legacy approval in selectors', () => {
  const reduce = domain.createWorkflowReducer(domain.STANDARD_PROCESS);
  const ready = reduce(domain.createInitialState(domain.STANDARD_PROCESS), {
    type: 'updateRecord',
    taskId: 'goals',
    patch: validRecord('goals'),
  });
  const changed = reduce(ready, { type: 'updateRecord', taskId: 'goals', patch: { note: 'Changed decision' } });
  expect(changed.records.goals?.document?.reviewStatus).toBe('pending');
  expect(reduce(changed, { type: 'completeTask', taskId: 'goals' })).toBe(changed);
  const legacy = { ...domain.createInitialState(domain.STANDARD_PROCESS), phase: domain.awaitingApproval(0) };
  expect(domain.canApprove(legacy, 0, domain.STANDARD_PROCESS)).toBe(false);
});
