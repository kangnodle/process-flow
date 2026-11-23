import type { StageDef, StageId, TaskDef, TaskId } from './model';

export interface StageText {
  readonly name: string;
  readonly description: string;
}

export interface TaskText {
  readonly name: string;
  readonly output: string;
  readonly description: string;
}

export interface ProcessText<S extends StageId = StageId, T extends TaskId = TaskId> {
  readonly stages: Readonly<Record<S, StageText>>;
  readonly tasks: Readonly<Record<T, TaskText>>;
}

export function stageText(text: ProcessText, stage: StageDef): StageText {
  return text.stages[stage.id] ?? { name: stage.id, description: '' };
}

export function taskText(text: ProcessText, task: TaskDef): TaskText {
  return text.tasks[task.id] ?? { name: task.id, output: '', description: '' };
}
