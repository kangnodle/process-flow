export type StageId = string;
export type TaskId = string;

export interface TaskDef {
  readonly id: TaskId;
  readonly stageId: StageId;
  readonly stageIndex: number;
  readonly number: number;
}

export interface StageDef {
  readonly id: StageId;
  readonly index: number;
  readonly tasks: readonly TaskDef[];
}

export interface ProcessSpec {
  readonly stages: readonly { readonly id: StageId; readonly tasks: readonly TaskId[] }[];
}

export interface Process {
  readonly stages: readonly StageDef[];
  readonly tasks: readonly TaskDef[];
  readonly lastStageIndex: number;
  readonly taskById: ReadonlyMap<TaskId, TaskDef>;
}

export function defineProcess(spec: ProcessSpec): Process {
  if (spec.stages.length === 0) {
    throw new Error('공정에는 단계가 하나 이상 있어야 합니다.');
  }
  const stageIds = new Set<StageId>();
  const taskById = new Map<TaskId, TaskDef>();
  let number = 0;

  const stages = spec.stages.map((stageSpec, stageIndex): StageDef => {
    if (stageIds.has(stageSpec.id)) {
      throw new Error(`단계 ID가 겹칩니다: ${stageSpec.id}`);
    }
    stageIds.add(stageSpec.id);
    if (stageSpec.tasks.length === 0) {
      throw new Error(`작업이 없는 단계가 있습니다: ${stageSpec.id}`);
    }
    const tasks = stageSpec.tasks.map((taskId): TaskDef => {
      if (taskById.has(taskId)) {
        throw new Error(`작업 ID가 겹칩니다: ${taskId}`);
      }
      number += 1;
      const task: TaskDef = { id: taskId, stageId: stageSpec.id, stageIndex, number };
      taskById.set(taskId, task);
      return task;
    });
    return { id: stageSpec.id, index: stageIndex, tasks };
  });

  return { stages, tasks: stages.flatMap((stage) => stage.tasks), lastStageIndex: stages.length - 1, taskById };
}

export function getTask(process: Process, id: TaskId): TaskDef {
  const task = process.taskById.get(id);
  if (!task) {
    throw new Error(`알 수 없는 작업 ID: ${id}`);
  }
  return task;
}

export function getStage(process: Process, index: number): StageDef {
  const stage = process.stages[index];
  if (!stage) {
    throw new Error(`알 수 없는 단계 번호: ${index}`);
  }
  return stage;
}

export function firstTaskOf(process: Process, stageIndex: number): TaskDef {
  const first = getStage(process, stageIndex).tasks[0];
  if (!first) {
    throw new Error(`${stageIndex}단계에 작업이 없습니다.`);
  }
  return first;
}

export function nextTask(process: Process, id: TaskId): TaskDef | undefined {
  return process.tasks[getTask(process, id).number];
}

export function previousTask(process: Process, id: TaskId): TaskDef | undefined {
  const index = getTask(process, id).number - 2;
  return index >= 0 ? process.tasks[index] : undefined;
}
