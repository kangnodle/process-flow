use std::fmt;

use crate::error::{DomainError, RuleViolation};
use crate::ids::TaskId;

use super::state::{Evidence, TaskDocument, TaskRecord, WorkflowState};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    CompleteTask {
        task_id: TaskId,
    },
    ReopenTask {
        task_id: TaskId,
    },
    ApproveStage {
        stage_index: usize,
    },
    RequestRework {
        task_id: TaskId,
        reason: String,
    },
    UpdateRecord {
        task_id: TaskId,
        link: Option<String>,
        note: Option<String>,
        document: Option<TaskDocument>,
        evidence: Option<Vec<Evidence>>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    TaskCompleted { task_id: TaskId, record: TaskRecord },
    TaskReopened { task_id: TaskId },
    StageApproved { stage_index: usize },
    ApprovalRevoked { stage_index: usize },
    ReworkRequested { task_id: TaskId, until_number: usize, reason: String },
    ReworkCompleted,
    RecordUpdated { task_id: TaskId, record: TaskRecord },
}

impl Event {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::TaskCompleted { .. } => "taskCompleted",
            Self::TaskReopened { .. } => "taskReopened",
            Self::StageApproved { .. } => "stageApproved",
            Self::ApprovalRevoked { .. } => "approvalRevoked",
            Self::ReworkRequested { .. } => "reworkRequested",
            Self::ReworkCompleted => "reworkCompleted",
            Self::RecordUpdated { .. } => "recordUpdated",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Unchanged,
    Changed { state: WorkflowState, events: Vec<Event> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    Domain(DomainError),
    Rule(RuleViolation),
}

impl From<DomainError> for CommandError {
    fn from(error: DomainError) -> Self {
        Self::Domain(error)
    }
}

impl From<RuleViolation> for CommandError {
    fn from(error: RuleViolation) -> Self {
        Self::Rule(error)
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Domain(error) => error.fmt(f),
            Self::Rule(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for CommandError {}
