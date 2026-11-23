use std::fmt;

use crate::ids::{StageId, TaskId};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DomainError {
    EmptyProcess,
    EmptyStage(StageId),
    DuplicateStage(StageId),
    DuplicateTask(TaskId),
    UnknownTask(TaskId),
    UnknownStage(usize),
    InvalidPhase(String),
    InvalidProject(String),
    InvalidUser(String),
    InvalidPassword(String),
    InvalidAssignment(String),
    LastOwner,
    LastAdmin,
}

impl fmt::Display for DomainError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyProcess => f.write_str("공정에는 단계가 하나 이상 있어야 합니다"),
            Self::EmptyStage(id) => write!(f, "작업이 없는 단계가 있습니다: {id}"),
            Self::DuplicateStage(id) => write!(f, "단계 ID가 겹칩니다: {id}"),
            Self::DuplicateTask(id) => write!(f, "작업 ID가 겹칩니다: {id}"),
            Self::UnknownTask(id) => write!(f, "알 수 없는 작업 ID: {id}"),
            Self::UnknownStage(index) => write!(f, "알 수 없는 단계 번호(0부터): {index}"),
            Self::InvalidPhase(reason) => write!(f, "진행 위치가 공정과 맞지 않습니다: {reason}"),
            Self::InvalidProject(reason) => write!(f, "프로젝트가 올바르지 않습니다: {reason}"),
            Self::InvalidUser(reason) => write!(f, "사용자가 올바르지 않습니다: {reason}"),
            Self::InvalidPassword(reason) => write!(f, "비밀번호가 올바르지 않습니다: {reason}"),
            Self::InvalidAssignment(reason) => write!(f, "담당 배정이 올바르지 않습니다: {reason}"),
            Self::LastOwner => f.write_str("프로젝트의 마지막 소유자는 빼거나 역할을 낮출 수 없습니다"),
            Self::LastAdmin => f.write_str("마지막 관리자는 비활성화하거나 관리자 권한을 뺄 수 없습니다"),
        }
    }
}

impl std::error::Error for DomainError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuleViolation {
    TaskDocumentIncomplete { task_id: TaskId, fields: Vec<String> },
    RecordReadOnly { task_id: TaskId },
    InvalidRecord(String),
    StageLocked { stage_index: usize, unlocked_stage: usize },
    NotFrontStage { stage_index: usize, unlocked_stage: usize },
    StageIncomplete { stage_index: usize, remaining: usize },
    LastStage { stage_index: usize },
    OutOfOrder { task_id: TaskId, expected: TaskId },
    NotLastCompleted { task_id: TaskId, last: TaskId },
    ReworkNotDone { task_id: TaskId },
    ReworkReasonRequired,
}

fn ordinal(stage_index: usize) -> usize {
    stage_index + 1
}

impl fmt::Display for RuleViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TaskDocumentIncomplete { task_id, fields } => {
                write!(f, "{task_id}: required document fields: {}", fields.join(", "))
            }
            Self::RecordReadOnly { task_id } => write!(f, "{task_id}: reopen or request rework before editing"),
            Self::InvalidRecord(reason) => write!(f, "Invalid task record: {reason}"),
            Self::StageLocked { stage_index, unlocked_stage } => {
                write!(
                    f,
                    "{}단계는 아직 잠겨 있습니다 (열린 단계: {}단계까지)",
                    ordinal(*stage_index),
                    ordinal(*unlocked_stage)
                )
            }
            Self::NotFrontStage { stage_index, unlocked_stage } => {
                write!(f, "{}단계는 현재 진행 단계({}단계)가 아닙니다", ordinal(*stage_index), ordinal(*unlocked_stage))
            }
            Self::StageIncomplete { stage_index, remaining } => {
                write!(f, "{}단계에 남은 작업이 {remaining}개 있습니다", ordinal(*stage_index))
            }
            Self::LastStage { stage_index } => write!(f, "{}단계는 마지막 단계입니다", ordinal(*stage_index)),
            Self::OutOfOrder { task_id, expected } => {
                write!(f, "작업은 순서대로 완료합니다: {task_id} 전에 {expected}을(를) 먼저 완료하세요")
            }
            Self::ReworkNotDone { task_id } => write!(f, "{task_id}은(는) 아직 완료하지 않아 재작업할 수 없습니다"),
            Self::ReworkReasonRequired => f.write_str("재작업 사유를 적어야 합니다"),
            Self::NotLastCompleted { task_id, last } => {
                write!(f, "{task_id}의 완료를 취소할 수 없습니다: 마지막으로 완료한 작업({last})만 취소할 수 있습니다")
            }
        }
    }
}

impl std::error::Error for RuleViolation {}
