use process_flow_domain::workflow::CommandError;
use process_flow_domain::{DomainError, RuleViolation};

#[derive(Debug, thiserror::Error)]
pub enum RepositoryError {
    #[error("버전 충돌: 기대한 버전 {expected}")]
    VersionConflict { expected: u64 },
    #[error("이미 있는 항목입니다: {0}")]
    AlreadyExists(String),
    #[error("저장된 데이터가 손상되었습니다: {0}")]
    Corrupted(String),
    #[error("저장소 오류: {0}")]
    Backend(String),
}

#[derive(Debug, thiserror::Error)]
pub enum ApplicationError {
    #[error("{entity}을(를) 찾을 수 없습니다: {id}")]
    NotFound { entity: &'static str, id: String },
    #[error("요청이 올바르지 않습니다: {0}")]
    Invalid(String),
    #[error(transparent)]
    Rule(RuleViolation),
    #[error("{0}")]
    Conflict(String),
    #[error("버전 충돌: 요청한 버전 {expected}이(가) 최신이 아닙니다")]
    VersionConflict { expected: u64 },
    #[error("로그인이 필요합니다")]
    Unauthenticated,
    #[error("이메일 또는 비밀번호가 올바르지 않습니다")]
    InvalidCredentials,
    #[error("로그인 시도가 너무 많습니다. 잠시 뒤에 다시 시도하세요")]
    TooManyAttempts,
    #[error("권한이 없습니다: {0}")]
    Forbidden(String),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
    #[error("외부 서비스 오류: {0}")]
    External(String),
}

impl From<CommandError> for ApplicationError {
    fn from(error: CommandError) -> Self {
        match error {
            CommandError::Rule(violation) => Self::Rule(violation),
            CommandError::Domain(domain) => domain.into(),
        }
    }
}

impl From<DomainError> for ApplicationError {
    fn from(error: DomainError) -> Self {
        match error {
            DomainError::UnknownTask(id) => Self::NotFound { entity: "작업", id: id.into_inner() },
            DomainError::UnknownStage(index) => Self::NotFound { entity: "단계", id: index.to_string() },
            DomainError::LastOwner | DomainError::LastAdmin => Self::Conflict(error.to_string()),
            DomainError::EmptyProcess
            | DomainError::EmptyStage(_)
            | DomainError::DuplicateStage(_)
            | DomainError::DuplicateTask(_)
            | DomainError::InvalidPhase(_)
            | DomainError::InvalidProject(_)
            | DomainError::InvalidUser(_)
            | DomainError::InvalidPassword(_)
            | DomainError::InvalidAssignment(_) => Self::Invalid(error.to_string()),
        }
    }
}

pub type AppResult<T> = Result<T, ApplicationError>;

pub fn require_admin(actor: &process_flow_domain::user::Actor) -> AppResult<()> {
    if actor.is_admin { Ok(()) } else { Err(ApplicationError::Forbidden("관리자만 할 수 있습니다".into())) }
}
