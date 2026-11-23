use crate::process::Process;

use super::command::{Command, CommandError, Decision, Event};
use super::document::{require_document, validate_record};
use super::state::{Rework, TaskRecord, WorkflowState};
use crate::error::RuleViolation;

pub fn decide(process: &Process, state: &WorkflowState, command: &Command) -> Result<Decision, CommandError> {
    match command {
        Command::CompleteTask { task_id } => {
            let task = process.task(task_id)?;
            let Some(phase) = state.phase.complete(process, task)? else { return Ok(Decision::Unchanged) };
            let record = state.record(task_id);
            require_document(task_id, &record)?;
            validate_record(state, task_id, &record)?;
            let mut events = vec![Event::TaskCompleted { task_id: task_id.clone(), record }];
            let completed = phase.completed_count(process);
            let rework = state.rework.clone().filter(|rework| rework.until_number > completed);
            if state.rework.is_some() && rework.is_none() {
                events.push(Event::ReworkCompleted);
            }
            Ok(Decision::Changed { state: WorkflowState { phase, rework, ..state.clone() }, events })
        }

        Command::ReopenTask { task_id } => {
            let task = process.task(task_id)?;
            let Some(reopened) = state.phase.reopen(process, task)? else { return Ok(Decision::Unchanged) };
            let mut events = Vec::new();
            if let Some(stage_index) = reopened.revoked_approval {
                events.push(Event::ApprovalRevoked { stage_index });
            }
            events.push(Event::TaskReopened { task_id: task_id.clone() });
            Ok(Decision::Changed { state: WorkflowState { phase: reopened.phase, ..state.clone() }, events })
        }

        Command::ApproveStage { stage_index } => {
            let stage_index = *stage_index;
            process.stage(stage_index)?;
            let Some(phase) = state.phase.approve(process, stage_index)? else { return Ok(Decision::Unchanged) };
            for task in &process.stage(stage_index)?.tasks {
                require_document(&task.id, &state.record(&task.id))?;
            }
            Ok(Decision::Changed {
                state: WorkflowState { phase, ..state.clone() },
                events: vec![Event::StageApproved { stage_index }],
            })
        }

        Command::RequestRework { task_id, reason } => {
            let task = process.task(task_id)?;
            let reason = reason.trim();
            if reason.is_empty() {
                return Err(RuleViolation::ReworkReasonRequired.into());
            }
            let (phase, revoked) = state.phase.rewind_to(process, task)?;
            let until_number =
                state.rework.as_ref().map_or(0, |rework| rework.until_number).max(state.phase.reached_number(process));
            let mut events: Vec<Event> =
                revoked.into_iter().rev().map(|stage_index| Event::ApprovalRevoked { stage_index }).collect();
            events.push(Event::ReworkRequested { task_id: task_id.clone(), until_number, reason: reason.to_owned() });
            let rework = Some(Rework { until_number, reason: reason.to_owned() });
            Ok(Decision::Changed { state: WorkflowState { phase, rework, ..state.clone() }, events })
        }

        Command::UpdateRecord { task_id, link, note, document, evidence } => {
            let task = process.task(task_id)?;
            if state.is_stage_locked(task.stage_index) {
                return Err(RuleViolation::StageLocked {
                    stage_index: task.stage_index,
                    unlocked_stage: state.phase.front_stage(process),
                }
                .into());
            }
            if task.number <= state.phase.completed_count(process) {
                return Err(RuleViolation::RecordReadOnly { task_id: task_id.clone() }.into());
            }
            let current = state.record(task_id);
            let mut merged = TaskRecord {
                link: link.clone().unwrap_or_else(|| current.link.clone()),
                note: note.clone().unwrap_or_else(|| current.note.clone()),
                document: document.clone().or_else(|| current.document.clone()),
                evidence: evidence.clone().or_else(|| current.evidence.clone()),
            };
            if merged == current {
                return Ok(Decision::Unchanged);
            }
            if document.is_none()
                && let Some(document) = &mut merged.document
            {
                document.review_status = super::ReviewStatus::Pending;
            }
            validate_record(state, task_id, &merged)?;
            let mut next = state.clone();
            if merged.is_empty() {
                next.records.remove(task_id);
            } else {
                next.records.insert(task_id.clone(), merged.clone());
            }
            Ok(Decision::Changed {
                state: next,
                events: vec![Event::RecordUpdated { task_id: task_id.clone(), record: merged }],
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::{DomainError, RuleViolation};
    use crate::process::{ProcessSpec, StageSpec, define_process};
    use crate::workflow::{Phase, overall_progress};

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

    fn apply(process: &Process, state: WorkflowState, command: Command) -> WorkflowState {
        match match decide(process, &state, &command) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        } {
            Decision::Unchanged => state,
            Decision::Changed { state, .. } => state,
        }
    }

    fn complete(id: &str) -> Command {
        Command::CompleteTask { task_id: id.into() }
    }

    fn reopen(id: &str) -> Command {
        Command::ReopenTask { task_id: id.into() }
    }

    #[test]
    fn locked_stage_rejects_changes() {
        let p = process();
        let result = decide(&p, &WorkflowState::default(), &complete("b1"));
        assert_eq!(result, Err(RuleViolation::StageLocked { stage_index: 1, unlocked_stage: 0 }.into()));
    }

    #[test]
    fn tasks_complete_in_order_only() {
        let p = process();
        let result = decide(&p, &WorkflowState::default(), &complete("a2"));
        assert_eq!(result, Err(RuleViolation::OutOfOrder { task_id: "a2".into(), expected: "a1".into() }.into()));
    }

    #[test]
    fn finishing_a_stage_waits_for_approval() {
        let p = process();
        let state = apply(&p, WorkflowState::default(), complete("a1"));
        let state = apply(&p, state, complete("a2"));
        assert_eq!(state.phase, Phase::AwaitingApproval { stage_index: 0 });
        assert!(state.is_stage_locked(1));
        assert_eq!(overall_progress(&p, &state).done, 2);

        let Decision::Changed { state, events } = (match decide(&p, &state, &Command::ApproveStage { stage_index: 0 }) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        }) else {
            panic!("변경되어야 합니다")
        };
        assert_eq!(state.phase, Phase::Working { stage_index: 1, completed: 0 });
        assert_eq!(events, vec![Event::StageApproved { stage_index: 0 }]);
        assert_eq!(decide(&p, &state, &Command::ApproveStage { stage_index: 0 }), Ok(Decision::Unchanged));
    }

    #[test]
    fn approve_requires_complete_front_stage() {
        let p = process();
        let state = apply(&p, WorkflowState::default(), complete("a1"));
        let result = decide(&p, &state, &Command::ApproveStage { stage_index: 0 });
        assert_eq!(result, Err(RuleViolation::StageIncomplete { stage_index: 0, remaining: 1 }.into()));
        assert_eq!(
            decide(&p, &state, &Command::ApproveStage { stage_index: 1 }),
            Err(RuleViolation::LastStage { stage_index: 1 }.into())
        );
    }

    #[test]
    fn completing_done_task_is_idempotent() {
        let p = process();
        let state = apply(&p, WorkflowState::default(), complete("a1"));
        assert_eq!(decide(&p, &state, &complete("a1")), Ok(Decision::Unchanged));
        assert_eq!(decide(&p, &state, &reopen("a2")), Ok(Decision::Unchanged));
    }

    #[test]
    fn only_the_last_completed_task_can_be_reopened() {
        let p = process();
        let state = apply(&p, WorkflowState::default(), complete("a1"));
        let state = apply(&p, state, complete("a2"));
        assert_eq!(
            decide(&p, &state, &reopen("a1")),
            Err(RuleViolation::NotLastCompleted { task_id: "a1".into(), last: "a2".into() }.into())
        );
        let state = apply(&p, state, reopen("a2"));
        assert_eq!(state.phase, Phase::Working { stage_index: 0, completed: 1 });
    }

    #[test]
    fn reopening_before_next_stage_work_revokes_approval() {
        let p = process();
        let state = WorkflowState { phase: Phase::Working { stage_index: 1, completed: 0 }, ..Default::default() };
        let Decision::Changed { state, events } = (match decide(&p, &state, &reopen("a2")) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        }) else {
            panic!("변경되어야 합니다")
        };
        assert_eq!(state.phase, Phase::Working { stage_index: 0, completed: 1 });
        assert_eq!(
            events,
            vec![Event::ApprovalRevoked { stage_index: 0 }, Event::TaskReopened { task_id: "a2".into() }]
        );
    }

    #[test]
    fn rework_rewinds_revokes_approval_and_finishes_when_redone() {
        let p = process();
        let state = WorkflowState { phase: Phase::Finished, ..Default::default() };
        let request = |id: &str, reason: &str| Command::RequestRework { task_id: id.into(), reason: reason.into() };

        assert_eq!(decide(&p, &state, &request("a2", "  ")), Err(RuleViolation::ReworkReasonRequired.into()));

        let Decision::Changed { state, events } = (match decide(&p, &state, &request("a2", " 누락 ")) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        }) else {
            panic!("변경되어야 합니다")
        };
        assert_eq!(state.phase, Phase::Working { stage_index: 0, completed: 1 });
        assert_eq!(state.rework, Some(Rework { until_number: 3, reason: "누락".into() }));
        assert_eq!(
            events,
            vec![
                Event::ApprovalRevoked { stage_index: 0 },
                Event::ReworkRequested { task_id: "a2".into(), until_number: 3, reason: "누락".into() },
            ]
        );
        assert!(state.is_rework(
            &p,
            match p.task(&"b1".into()) {
                Ok(value) => value,
                Err(error) => panic!("expected task to succeed: {error:?}"),
            }
        ));
        assert_eq!(
            decide(&p, &state, &request("b1", "왜")),
            Err(RuleViolation::ReworkNotDone { task_id: "b1".into() }.into())
        );

        let state = apply(&p, state, complete("a2"));
        let state = apply(&p, state, Command::ApproveStage { stage_index: 0 });
        assert!(state.rework.is_some());
        let Decision::Changed { state, events } = (match decide(&p, &state, &complete("b1")) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        }) else {
            panic!("변경되어야 합니다")
        };
        assert_eq!(state.rework, None);
        assert_eq!(events.last(), Some(&Event::ReworkCompleted));
    }

    #[test]
    fn update_record_merges_and_clears() {
        let p = process();
        let patch = |link: Option<&str>, note: Option<&str>| Command::UpdateRecord {
            task_id: "a1".into(),
            document: None,
            evidence: None,
            link: link.map(Into::into),
            note: note.map(Into::into),
        };
        let state = apply(&p, WorkflowState::default(), patch(Some("https://x"), None));
        let state = apply(&p, state, patch(None, Some("memo")));
        assert_eq!(
            state.record(&"a1".into()),
            TaskRecord { link: "https://x".into(), note: "memo".into(), ..Default::default() }
        );
        assert_eq!(decide(&p, &state, &patch(Some("https://x"), None)), Ok(Decision::Unchanged));
        let state = apply(&p, state, patch(Some(""), Some("")));
        assert!(state.records.is_empty());
    }

    #[test]
    fn unknown_task_is_domain_error() {
        let result = decide(&process(), &WorkflowState::default(), &complete("zzz"));
        assert_eq!(result, Err(DomainError::UnknownTask("zzz".into()).into()));
    }
}
