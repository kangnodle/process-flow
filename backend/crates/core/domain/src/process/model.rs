use std::collections::{HashMap, HashSet};

use crate::error::DomainError;
use crate::ids::{ProcessId, StageId, TaskId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessSpec {
    pub id: ProcessId,
    pub stages: Vec<StageSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageSpec {
    pub id: StageId,
    pub tasks: Vec<TaskId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskDef {
    pub id: TaskId,
    pub stage_id: StageId,
    pub stage_index: usize,
    pub number: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StageDef {
    pub id: StageId,
    pub index: usize,
    pub tasks: Vec<TaskDef>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Process {
    id: ProcessId,
    stages: Vec<StageDef>,
    task_index: HashMap<TaskId, (usize, usize)>,
}

pub fn define_process(spec: ProcessSpec) -> Result<Process, DomainError> {
    if spec.stages.is_empty() {
        return Err(DomainError::EmptyProcess);
    }
    let mut stage_ids = HashSet::new();
    let mut task_index = HashMap::new();
    let mut number = 0;
    let mut stages = Vec::with_capacity(spec.stages.len());

    for (stage_index, stage_spec) in spec.stages.into_iter().enumerate() {
        if !stage_ids.insert(stage_spec.id.clone()) {
            return Err(DomainError::DuplicateStage(stage_spec.id));
        }
        if stage_spec.tasks.is_empty() {
            return Err(DomainError::EmptyStage(stage_spec.id));
        }
        let mut tasks = Vec::with_capacity(stage_spec.tasks.len());
        for (position, task_id) in stage_spec.tasks.into_iter().enumerate() {
            if task_index.insert(task_id.clone(), (stage_index, position)).is_some() {
                return Err(DomainError::DuplicateTask(task_id));
            }
            number += 1;
            tasks.push(TaskDef { id: task_id, stage_id: stage_spec.id.clone(), stage_index, number });
        }
        stages.push(StageDef { id: stage_spec.id, index: stage_index, tasks });
    }

    Ok(Process { id: spec.id, stages, task_index })
}

impl Process {
    pub fn id(&self) -> &ProcessId {
        &self.id
    }

    pub fn stages(&self) -> &[StageDef] {
        &self.stages
    }

    pub fn tasks(&self) -> impl Iterator<Item = &TaskDef> {
        self.stages.iter().flat_map(|stage| stage.tasks.iter())
    }

    pub fn task_count(&self) -> usize {
        self.task_index.len()
    }

    pub fn last_stage_index(&self) -> usize {
        self.stages.len() - 1
    }

    pub fn task(&self, id: &TaskId) -> Result<&TaskDef, DomainError> {
        let (stage, position) = self.task_index.get(id).ok_or_else(|| DomainError::UnknownTask(id.clone()))?;
        Ok(&self.stages[*stage].tasks[*position])
    }

    pub fn stage(&self, index: usize) -> Result<&StageDef, DomainError> {
        self.stages.get(index).ok_or(DomainError::UnknownStage(index))
    }

    pub fn next_task(&self, id: &TaskId) -> Result<Option<&TaskDef>, DomainError> {
        let number = self.task(id)?.number;
        Ok(self.tasks().nth(number))
    }

    pub fn to_spec(&self) -> ProcessSpec {
        ProcessSpec {
            id: self.id.clone(),
            stages: self
                .stages
                .iter()
                .map(|stage| StageSpec {
                    id: stage.id.clone(),
                    tasks: stage.tasks.iter().map(|task| task.id.clone()).collect(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(stages: &[(&str, &[&str])]) -> ProcessSpec {
        ProcessSpec {
            id: "p".into(),
            stages: stages
                .iter()
                .map(|(id, tasks)| StageSpec { id: (*id).into(), tasks: tasks.iter().map(|t| (*t).into()).collect() })
                .collect(),
        }
    }

    #[test]
    fn numbers_tasks_across_stages() {
        let process = match define_process(spec(&[("a", &["a1", "a2"]), ("b", &["b1"])])) {
            Ok(value) => value,
            Err(error) => panic!("expected define_process to succeed: {error:?}"),
        };
        let b1 = match process.task(&"b1".into()) {
            Ok(value) => value,
            Err(error) => panic!("expected task to succeed: {error:?}"),
        };
        assert_eq!((b1.stage_index, b1.number), (1, 3));
        assert_eq!(
            match process.next_task(&"a2".into()) {
                Ok(value) => value,
                Err(error) => panic!("expected next_task to succeed: {error:?}"),
            }
            .map(|t| t.id.as_str()),
            Some("b1")
        );
        assert_eq!(
            match process.next_task(&"b1".into()) {
                Ok(value) => value,
                Err(error) => panic!("expected next_task to succeed: {error:?}"),
            },
            None
        );
    }

    #[test]
    fn rejects_invalid_specs() {
        assert_eq!(define_process(spec(&[])), Err(DomainError::EmptyProcess));
        assert_eq!(define_process(spec(&[("a", &[])])), Err(DomainError::EmptyStage("a".into())));
        assert_eq!(define_process(spec(&[("a", &["x"]), ("a", &["y"])])), Err(DomainError::DuplicateStage("a".into())));
        assert_eq!(define_process(spec(&[("a", &["x"]), ("b", &["x"])])), Err(DomainError::DuplicateTask("x".into())));
    }

    #[test]
    fn round_trips_through_spec() {
        let original = spec(&[("a", &["a1", "a2"]), ("b", &["b1"])]);
        assert_eq!(
            match define_process(original.clone()) {
                Ok(value) => value,
                Err(error) => panic!("expected define_process to succeed: {error:?}"),
            }
            .to_spec(),
            original
        );
    }
}
