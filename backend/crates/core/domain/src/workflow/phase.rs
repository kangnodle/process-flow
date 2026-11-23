use std::collections::BTreeSet;

use crate::error::{DomainError, RuleViolation};
use crate::ids::TaskId;
use crate::process::{Process, TaskDef};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Working { stage_index: usize, completed: usize },
    AwaitingApproval { stage_index: usize },
    Finished,
}

impl Default for Phase {
    fn default() -> Self {
        Self::Working { stage_index: 0, completed: 0 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Reopened {
    pub phase: Phase,
    pub revoked_approval: Option<usize>,
}

fn tasks_before(process: &Process, stage_index: usize) -> usize {
    process.stages().iter().take(stage_index).map(|stage| stage.tasks.len()).sum()
}

fn stage_size(process: &Process, stage_index: usize) -> usize {
    process.stage(stage_index).map(|stage| stage.tasks.len()).unwrap_or(0)
}

impl Phase {
    pub fn validate(&self, process: &Process) -> Result<(), DomainError> {
        let last = process.last_stage_index();
        match *self {
            Self::Working { stage_index, completed } => {
                process.stage(stage_index)?;
                if completed < stage_size(process, stage_index) {
                    Ok(())
                } else {
                    Err(DomainError::InvalidPhase(format!(
                        "{}단계의 완료 수가 범위를 벗어났습니다: {completed}",
                        stage_index + 1
                    )))
                }
            }
            Self::AwaitingApproval { stage_index } if stage_index < last => Ok(()),
            Self::AwaitingApproval { stage_index } => {
                Err(DomainError::InvalidPhase(format!("{}단계는 승인을 기다릴 수 없습니다", stage_index + 1)))
            }
            Self::Finished => Ok(()),
        }
    }

    pub fn front_stage(&self, process: &Process) -> usize {
        match *self {
            Self::Working { stage_index, .. } | Self::AwaitingApproval { stage_index } => stage_index,
            Self::Finished => process.last_stage_index(),
        }
    }

    pub fn is_stage_locked(&self, stage_index: usize) -> bool {
        match *self {
            Self::Working { stage_index: front, .. } | Self::AwaitingApproval { stage_index: front } => {
                stage_index > front
            }
            Self::Finished => false,
        }
    }

    pub fn completed_count(&self, process: &Process) -> usize {
        match *self {
            Self::Working { stage_index, completed } => tasks_before(process, stage_index) + completed,
            Self::AwaitingApproval { stage_index } => tasks_before(process, stage_index + 1),
            Self::Finished => process.task_count(),
        }
    }

    pub fn is_done(&self, process: &Process, task: &TaskDef) -> bool {
        task.number <= self.completed_count(process)
    }

    pub fn current_task<'p>(&self, process: &'p Process) -> Option<&'p TaskDef> {
        match *self {
            Self::Working { stage_index, completed } => process.stage(stage_index).ok()?.tasks.get(completed),
            _ => None,
        }
    }

    pub fn last_completed<'p>(&self, process: &'p Process) -> Option<&'p TaskDef> {
        let count = self.completed_count(process);
        count.checked_sub(1).and_then(|index| process.tasks().nth(index))
    }

    pub fn complete(&self, process: &Process, task: &TaskDef) -> Result<Option<Phase>, RuleViolation> {
        if self.is_stage_locked(task.stage_index) {
            return Err(RuleViolation::StageLocked {
                stage_index: task.stage_index,
                unlocked_stage: self.front_stage(process),
            });
        }
        let Self::Working { stage_index, completed } = *self else {
            return Ok(None);
        };
        match self.current_task(process) {
            Some(current) if current.id == task.id => {}
            Some(_) if self.is_done(process, task) => return Ok(None),
            Some(current) => {
                return Err(RuleViolation::OutOfOrder { task_id: task.id.clone(), expected: current.id.clone() });
            }
            None => return Ok(None),
        }
        let completed = completed + 1;
        Ok(Some(if completed < stage_size(process, stage_index) {
            Self::Working { stage_index, completed }
        } else if stage_index == process.last_stage_index() {
            Self::Finished
        } else {
            Self::AwaitingApproval { stage_index }
        }))
    }

    pub fn approve(&self, process: &Process, stage_index: usize) -> Result<Option<Phase>, RuleViolation> {
        if stage_index >= process.last_stage_index() {
            return Err(RuleViolation::LastStage { stage_index });
        }
        match *self {
            Self::AwaitingApproval { stage_index: waiting } if waiting == stage_index => {
                Ok(Some(Self::Working { stage_index: stage_index + 1, completed: 0 }))
            }
            Self::Working { stage_index: front, completed } if front == stage_index => {
                Err(RuleViolation::StageIncomplete {
                    stage_index,
                    remaining: stage_size(process, stage_index) - completed,
                })
            }
            _ if stage_index < self.front_stage(process) => Ok(None),
            _ => Err(RuleViolation::NotFrontStage { stage_index, unlocked_stage: self.front_stage(process) }),
        }
    }

    pub fn reopen(&self, process: &Process, task: &TaskDef) -> Result<Option<Reopened>, RuleViolation> {
        if !self.is_done(process, task) {
            return Ok(None);
        }
        let Some(last) = self.last_completed(process) else { return Ok(None) };
        if last.id != task.id {
            return Err(RuleViolation::NotLastCompleted { task_id: task.id.clone(), last: last.id.clone() });
        }
        let reopened =
            Self::Working { stage_index: last.stage_index, completed: stage_size(process, last.stage_index) - 1 };
        Ok(Some(match *self {
            Self::Working { stage_index, completed } if completed > 0 => {
                Reopened { phase: Self::Working { stage_index, completed: completed - 1 }, revoked_approval: None }
            }
            Self::Working { .. } => Reopened { phase: reopened, revoked_approval: Some(last.stage_index) },
            Self::AwaitingApproval { .. } | Self::Finished => Reopened { phase: reopened, revoked_approval: None },
        }))
    }

    pub fn reached_number(&self, process: &Process) -> usize {
        self.completed_count(process) + usize::from(matches!(self, Self::Working { .. }))
    }

    pub fn rewind_to(&self, process: &Process, task: &TaskDef) -> Result<(Phase, Vec<usize>), RuleViolation> {
        if !self.is_done(process, task) {
            return Err(RuleViolation::ReworkNotDone { task_id: task.id.clone() });
        }
        let revoked = (task.stage_index..self.front_stage(process)).collect();
        let completed = task.number - 1 - tasks_before(process, task.stage_index);
        Ok((Self::Working { stage_index: task.stage_index, completed }, revoked))
    }

    pub fn from_legacy(process: &Process, unlocked_stage: usize, done: &BTreeSet<TaskId>) -> Phase {
        let last = process.last_stage_index();
        for stage in process.stages() {
            let completed = stage.tasks.iter().take_while(|task| done.contains(&task.id)).count();
            if completed < stage.tasks.len() {
                return Self::Working { stage_index: stage.index, completed };
            }
            if stage.index == last {
                return Self::Finished;
            }
            if stage.index >= unlocked_stage {
                return Self::AwaitingApproval { stage_index: stage.index };
            }
        }
        Self::Finished
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::{ProcessSpec, StageSpec, define_process};

    fn process() -> Process {
        match define_process(ProcessSpec {
            id: "p".into(),
            stages: vec![
                StageSpec { id: "a".into(), tasks: vec!["a1".into(), "a2".into()] },
                StageSpec { id: "b".into(), tasks: vec!["b1".into()] },
            ],
        }) {
            Ok(value) => value,
            Err(error) => panic!("expected define_process to succeed: {error:?}"),
        }
    }

    fn task<'p>(p: &'p Process, id: &str) -> &'p TaskDef {
        match p.task(&id.into()) {
            Ok(value) => value,
            Err(error) => panic!("expected task to succeed: {error:?}"),
        }
    }

    #[test]
    fn walks_the_line_in_order() {
        let p = process();
        let phase = Phase::default();
        assert_eq!(phase.current_task(&p).map(|t| t.id.as_str()), Some("a1"));
        let phase = match match phase.complete(&p, task(&p, "a1")) {
            Ok(value) => value,
            Err(error) => panic!("expected complete to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(phase.complete(&p, task(&p, "a1")), Ok(None));
        let phase = match match phase.complete(&p, task(&p, "a2")) {
            Ok(value) => value,
            Err(error) => panic!("expected complete to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(phase, Phase::AwaitingApproval { stage_index: 0 });
        assert!(phase.is_stage_locked(1));
        let phase = match match phase.approve(&p, 0) {
            Ok(value) => value,
            Err(error) => panic!("expected approve to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(phase, Phase::Working { stage_index: 1, completed: 0 });
        let phase = match match phase.complete(&p, task(&p, "b1")) {
            Ok(value) => value,
            Err(error) => panic!("expected complete to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(phase, Phase::Finished);
        assert_eq!(phase.completed_count(&p), 3);
    }

    #[test]
    fn rejects_out_of_order_and_locked() {
        let p = process();
        let phase = Phase::default();
        assert_eq!(
            phase.complete(&p, task(&p, "a2")),
            Err(RuleViolation::OutOfOrder { task_id: "a2".into(), expected: "a1".into() })
        );
        assert_eq!(
            phase.complete(&p, task(&p, "b1")),
            Err(RuleViolation::StageLocked { stage_index: 1, unlocked_stage: 0 })
        );
    }

    #[test]
    fn only_last_completed_can_be_reopened() {
        let p = process();
        let phase = Phase::AwaitingApproval { stage_index: 0 };
        assert_eq!(
            phase.reopen(&p, task(&p, "a1")),
            Err(RuleViolation::NotLastCompleted { task_id: "a1".into(), last: "a2".into() })
        );
        assert_eq!(
            phase.reopen(&p, task(&p, "a2")),
            Ok(Some(Reopened { phase: Phase::Working { stage_index: 0, completed: 1 }, revoked_approval: None }))
        );
        assert_eq!(Phase::default().reopen(&p, task(&p, "a1")), Ok(None));
    }

    #[test]
    fn reopening_across_an_untouched_approval_revokes_it() {
        let p = process();
        let phase = Phase::Working { stage_index: 1, completed: 0 };
        assert_eq!(
            phase.reopen(&p, task(&p, "a2")),
            Ok(Some(Reopened { phase: Phase::Working { stage_index: 0, completed: 1 }, revoked_approval: Some(0) }))
        );
    }

    #[test]
    fn approve_explains_why_not() {
        let p = process();
        assert_eq!(
            Phase::default().approve(&p, 0),
            Err(RuleViolation::StageIncomplete { stage_index: 0, remaining: 2 })
        );
        assert_eq!(Phase::default().approve(&p, 1), Err(RuleViolation::LastStage { stage_index: 1 }));
        let opened = Phase::Working { stage_index: 1, completed: 0 };
        assert_eq!(opened.approve(&p, 0), Ok(None));
    }

    #[test]
    fn validates_stored_values() {
        let p = process();
        assert!(Phase::Working { stage_index: 0, completed: 1 }.validate(&p).is_ok());
        assert!(Phase::Working { stage_index: 0, completed: 2 }.validate(&p).is_err());
        assert!(Phase::AwaitingApproval { stage_index: 1 }.validate(&p).is_err());
        assert!(Phase::Working { stage_index: 2, completed: 0 }.validate(&p).is_err());
    }

    #[test]
    fn rewinds_to_a_done_task_and_revokes_later_approvals() {
        let p = process();
        let finished = Phase::Finished;
        assert_eq!(finished.reached_number(&p), 3);
        assert_eq!(
            finished.rewind_to(&p, task(&p, "a2")),
            Ok((Phase::Working { stage_index: 0, completed: 1 }, vec![0]))
        );
        let working = Phase::Working { stage_index: 1, completed: 0 };
        assert_eq!(working.reached_number(&p), 3);
        assert_eq!(working.rewind_to(&p, task(&p, "b1")), Err(RuleViolation::ReworkNotDone { task_id: "b1".into() }));
    }

    #[test]
    fn converts_legacy_progress() {
        let p = process();
        let set = |ids: &[&str]| ids.iter().map(|id| TaskId::from(*id)).collect::<BTreeSet<_>>();
        assert_eq!(Phase::from_legacy(&p, 0, &set(&[])), Phase::default());
        assert_eq!(Phase::from_legacy(&p, 0, &set(&["a2"])), Phase::Working { stage_index: 0, completed: 0 });
        assert_eq!(Phase::from_legacy(&p, 0, &set(&["a1", "a2"])), Phase::AwaitingApproval { stage_index: 0 });
        assert_eq!(Phase::from_legacy(&p, 1, &set(&["a1", "a2"])), Phase::Working { stage_index: 1, completed: 0 });
        assert_eq!(Phase::from_legacy(&p, 1, &set(&["a1", "a2", "b1"])), Phase::Finished);
    }
}
