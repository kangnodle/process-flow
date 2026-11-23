use process_flow_domain::assignment::Assignments;
use process_flow_domain::membership::Role;
use process_flow_domain::process::Process;
use process_flow_domain::workflow::{Command, Decision, Workflow, decide};
use process_flow_domain::{RuleViolation, UserId};

use crate::error::{AppResult, ApplicationError};
use crate::workflow_policy::CommandPlan;

pub use process_flow_domain::assignment::WorkflowRole;

#[derive(Debug)]
pub enum CommandValidation {
    Valid,
    InvalidRecord(RuleViolation),
}

#[derive(Debug)]
pub struct ValidatedCommand {
    pub command: Command,
    pub validation: CommandValidation,
}

#[derive(Debug)]
pub struct WorkflowCommandContext<'a> {
    pub workflow: &'a Workflow,
    pub process: &'a Process,
    pub assignments: &'a Assignments,
    pub actor: &'a UserId,
    pub access_role: Role,
}

impl WorkflowCommandContext<'_> {
    pub fn interaction_role<'a>(&self, command: &'a Command) -> WorkflowRole<'a> {
        WorkflowRole::for_command(command)
    }

    pub fn plan(&self, input: &ValidatedCommand, expected_version: Option<u64>) -> AppResult<Option<CommandPlan>> {
        self.plan_command(&input.command, expected_version, &input.validation)
    }

    pub fn plan_command(
        &self,
        command: &Command,
        expected_version: Option<u64>,
        validation: &CommandValidation,
    ) -> AppResult<Option<CommandPlan>> {
        if let Some(expected) = expected_version.filter(|version| *version != self.workflow.version) {
            return Err(ApplicationError::VersionConflict { expected });
        }
        let authority = self
            .assignments
            .authorize_role(self.process, self.actor, self.access_role, self.interaction_role(command))
            .map_err(|denied| ApplicationError::Forbidden(denied.to_string()))?;
        let decision = decide(self.process, &self.workflow.state, command)?;
        if let CommandValidation::InvalidRecord(error) = validation {
            return Err(ApplicationError::Rule(error.clone()));
        }
        Ok(match decision {
            Decision::Unchanged => None,
            Decision::Changed { state, events } => {
                Some(CommandPlan { workflow: self.workflow.with_state(state), events, authority })
            }
        })
    }
}
