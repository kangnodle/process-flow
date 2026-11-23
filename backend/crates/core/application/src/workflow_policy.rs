use process_flow_domain::UserId;
use process_flow_domain::assignment::{Assignments, Authority};
use process_flow_domain::membership::Role;
use process_flow_domain::process::Process;
use process_flow_domain::workflow::{Command, Event, Workflow};

use crate::contexts::workflow::{CommandValidation, WorkflowCommandContext};
use crate::error::AppResult;
use crate::ports::RecordedEvent;

#[derive(Debug)]
pub struct CommandPlan {
    pub workflow: Workflow,
    pub events: Vec<Event>,
    pub(crate) authority: Authority,
}

impl CommandPlan {
    pub fn recorded_events(&self, actor: &UserId, occurred_at_ms: i64) -> Vec<RecordedEvent> {
        self.events
            .iter()
            .map(|event| RecordedEvent {
                workflow_id: self.workflow.id.clone(),
                version: self.workflow.version,
                occurred_at_ms,
                actor: actor.clone(),
                authority: self.authority,
                event: event.clone(),
            })
            .collect()
    }
}

pub fn plan_command(
    workflow: &Workflow,
    process: &Process,
    assignments: &Assignments,
    actor: &UserId,
    role: Role,
    command: &Command,
    expected_version: Option<u64>,
) -> AppResult<Option<CommandPlan>> {
    WorkflowCommandContext { workflow, process, assignments, actor, access_role: role }.plan_command(
        command,
        expected_version,
        &CommandValidation::Valid,
    )
}

#[cfg(test)]
mod tests {
    use process_flow_domain::assignment::Assignments;
    use process_flow_domain::membership::Role;
    use process_flow_domain::process::standard::standard_process;
    use process_flow_domain::workflow::{Command, Workflow};

    use super::plan_command;
    use crate::ApplicationError;

    #[test]
    fn stale_version_takes_precedence_over_command_validation() {
        let process = standard_process();
        let workflow = Workflow::start("workflow".into(), "project".into(), process.id().clone(), "Test".into());
        let result = plan_command(
            &workflow,
            &process,
            &Assignments::default(),
            &"user".into(),
            Role::Editor,
            &Command::CompleteTask { task_id: "unknown".into() },
            Some(workflow.version + 1),
        );

        assert!(
            matches!(result, Err(ApplicationError::VersionConflict { expected }) if expected == workflow.version + 1)
        );
    }
}
