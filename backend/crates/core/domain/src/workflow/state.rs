use std::collections::BTreeMap;

use crate::error::DomainError;
use crate::ids::{ProcessId, ProjectId, TaskId, WorkflowId};
use crate::process::Process;

use super::phase::Phase;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskRecord {
    pub link: String,
    pub note: String,
    pub document: Option<TaskDocument>,
    pub evidence: Option<Vec<Evidence>>,
}

impl TaskRecord {
    pub fn is_empty(&self) -> bool {
        self.link.is_empty()
            && self.note.is_empty()
            && self.document.is_none()
            && self.evidence.as_ref().is_none_or(Vec::is_empty)
    }

    pub fn searchable_text(&self) -> String {
        let mut parts = vec![self.note.as_str(), self.link.as_str()];
        if let Some(document) = &self.document {
            parts.extend(document.answers.values().map(String::as_str));
        }
        for evidence in self.evidence.iter().flatten() {
            parts.push(evidence.title());
            parts.push(evidence.description());
        }
        parts.into_iter().filter(|part| !part.is_empty()).collect::<Vec<_>>().join("\n")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TaskDocument {
    pub version: u32,
    pub answers: BTreeMap<String, String>,
    pub review_status: ReviewStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReviewStatus {
    Pending,
    Passed,
    Blocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinkEvidence {
    pub id: String,
    pub title: String,
    pub description: String,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEvidence {
    pub id: String,
    pub title: String,
    pub description: String,
    pub file_name: String,
    pub media_type: Option<String>,
    pub size: u64,
    pub base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Evidence {
    Link(LinkEvidence),
    File(FileEvidence),
}

impl Evidence {
    pub fn id(&self) -> &str {
        match self {
            Self::Link(item) => &item.id,
            Self::File(item) => &item.id,
        }
    }

    pub fn title(&self) -> &str {
        match self {
            Self::Link(item) => &item.title,
            Self::File(item) => &item.title,
        }
    }

    pub fn description(&self) -> &str {
        match self {
            Self::Link(item) => &item.description,
            Self::File(item) => &item.description,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rework {
    pub until_number: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkflowState {
    pub phase: Phase,
    pub rework: Option<Rework>,
    pub records: BTreeMap<TaskId, TaskRecord>,
}

impl WorkflowState {
    pub fn validate(&self, process: &Process) -> Result<(), DomainError> {
        self.phase.validate(process)?;
        if let Some(rework) = &self.rework {
            let completed = self.phase.completed_count(process);
            if rework.until_number <= completed || rework.until_number > process.task_count() {
                return Err(DomainError::InvalidPhase(format!("재작업 범위가 맞지 않습니다: {}", rework.until_number)));
            }
            if rework.reason.trim().is_empty() {
                return Err(DomainError::InvalidPhase("재작업 사유가 비어 있습니다".into()));
            }
        }
        Ok(())
    }

    pub fn is_rework(&self, process: &Process, task: &crate::process::TaskDef) -> bool {
        self.rework.as_ref().is_some_and(|rework| {
            task.number > self.phase.completed_count(process) && task.number <= rework.until_number
        })
    }

    pub fn done<'p>(&self, process: &'p Process) -> impl Iterator<Item = &'p TaskId> + use<'p> {
        let count = self.phase.completed_count(process);
        process.tasks().take(count).map(|task| &task.id)
    }

    pub fn is_stage_locked(&self, stage_index: usize) -> bool {
        self.phase.is_stage_locked(stage_index)
    }

    pub fn record(&self, task_id: &TaskId) -> TaskRecord {
        self.records.get(task_id).cloned().unwrap_or_default()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workflow {
    pub id: WorkflowId,
    pub project_id: ProjectId,
    pub process_id: ProcessId,
    pub name: String,
    pub state: WorkflowState,
    pub version: u64,
}

impl Workflow {
    pub fn start(id: WorkflowId, project_id: ProjectId, process_id: ProcessId, name: String) -> Self {
        Self { id, project_id, process_id, name, state: WorkflowState::default(), version: 0 }
    }

    pub fn with_state(&self, state: WorkflowState) -> Self {
        Self { state, version: self.version + 1, ..self.clone() }
    }
}
