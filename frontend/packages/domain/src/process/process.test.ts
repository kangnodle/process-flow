import { describe, expect, it } from 'vitest';
import { LOCALES } from '../locale';
import { defineProcess, firstTaskOf, getTask, nextTask, previousTask } from './model';
import { STANDARD_PROCESS as P, STANDARD_PROCESS_TEXT } from './standard';
import { stageText, taskText } from './text';

describe('defineProcess', () => {
  it('작업에 전체 순번과 소속 단계를 붙인다', () => {
    const process = defineProcess({
      stages: [
        { id: 'a', tasks: ['a1', 'a2'] },
        { id: 'b', tasks: ['b1'] },
      ],
    });
    expect(process.tasks.map((t) => [t.id, t.stageId, t.stageIndex, t.number])).toEqual([
      ['a1', 'a', 0, 1],
      ['a2', 'a', 0, 2],
      ['b1', 'b', 1, 3],
    ]);
    expect(process.lastStageIndex).toBe(1);
  });

  it('잘못된 정의는 예외를 던진다', () => {
    expect(() => defineProcess({ stages: [] })).toThrow();
    expect(() => defineProcess({ stages: [{ id: 'a', tasks: [] }] })).toThrow();
    expect(() =>
      defineProcess({
        stages: [
          { id: 'a', tasks: ['x'] },
          { id: 'a', tasks: ['y'] },
        ],
      }),
    ).toThrow();
    expect(() =>
      defineProcess({
        stages: [
          { id: 'a', tasks: ['x'] },
          { id: 'b', tasks: ['x'] },
        ],
      }),
    ).toThrow();
  });
});

describe('표준 공정', () => {
  it('6단계 25개 작업으로 구성되고 ID와 순번이 고유하다', () => {
    expect(P.stages).toHaveLength(6);
    expect(P.tasks).toHaveLength(25);
    expect(new Set(P.tasks.map((t) => t.id)).size).toBe(25);
    expect(P.tasks.map((t) => t.number)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });

  it('이전·다음 작업은 단계 경계를 넘어 이어진다', () => {
    expect(firstTaskOf(P, 1).id).toBe('wireframes');
    expect(previousTask(P, 'wireframes')?.id).toBe('constraints');
    expect(nextTask(P, 'constraints')?.id).toBe('wireframes');
    expect(previousTask(P, 'goals')).toBeUndefined();
    expect(nextTask(P, 'iteration')).toBeUndefined();
  });

  it('알 수 없는 작업 ID는 예외를 던진다', () => {
    expect(() => getTask(P, 'nope')).toThrow();
  });

  it('모든 언어에 모든 단계·작업의 문구가 비어 있지 않게 있다', () => {
    for (const locale of LOCALES) {
      const text = STANDARD_PROCESS_TEXT[locale];
      for (const stage of P.stages) {
        expect(stageText(text, stage).name, `${locale}/${stage.id}`).not.toBe(stage.id);
        expect(stageText(text, stage).description).not.toBe('');
      }
      for (const task of P.tasks) {
        const { name, output, description } = taskText(text, task);
        expect(name, `${locale}/${task.id}`).not.toBe(task.id);
        expect(output).not.toBe('');
        expect(description).not.toBe('');
      }
      expect(Object.keys(text.tasks)).toHaveLength(P.tasks.length);
    }
  });

  it('언어에 맞는 단계·작업 문구를 ID로 찾는다', () => {
    const stage = P.stages[0];
    if (!stage) throw new Error('단계가 없습니다.');
    expect(stageText(STANDARD_PROCESS_TEXT.ko, stage).name).toBe('기획·분석');
    expect(stageText(STANDARD_PROCESS_TEXT.en, stage).name).toBe('Planning & analysis');

    const task = getTask(P, 'wireframes');
    expect(taskText(STANDARD_PROCESS_TEXT.ko, task).name).toBe('와이어프레임');
    expect(taskText(STANDARD_PROCESS_TEXT.en, task)).toEqual({
      name: 'Wireframes',
      output: 'Wireframes',
      description: expect.stringContaining('layout') as unknown as string,
    });
  });

  it('문구가 없는 공정은 ID를 이름으로 보여 준다', () => {
    const process = defineProcess({ stages: [{ id: 'custom', tasks: ['custom-task'] }] });
    const task = getTask(process, 'custom-task');
    expect(taskText(STANDARD_PROCESS_TEXT.ko, task).name).toBe('custom-task');
  });
});
