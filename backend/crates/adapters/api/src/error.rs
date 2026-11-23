use actix_web::http::StatusCode;
use actix_web::{HttpResponse, ResponseError};
use process_flow_application::ApplicationError;
use process_flow_domain::RuleViolation;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    details: Option<Value>,
}

#[derive(Serialize)]
struct Body<'a> {
    error: Inner<'a>,
}

#[derive(Serialize)]
struct Inner<'a> {
    code: &'a str,
    message: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<&'a Value>,
}

impl ApiError {
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self { status: StatusCode::BAD_REQUEST, code: "badRequest", message: message.into(), details: None }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}: {}", self.status.as_u16(), self.code, self.message)
    }
}

impl ResponseError for ApiError {
    fn status_code(&self) -> StatusCode {
        self.status
    }

    fn error_response(&self) -> HttpResponse {
        HttpResponse::build(self.status)
            .json(Body { error: Inner { code: self.code, message: &self.message, details: self.details.as_ref() } })
    }
}

fn rule_details(violation: &RuleViolation) -> Value {
    match violation {
        RuleViolation::TaskDocumentIncomplete { task_id, fields } => {
            json!({"kind": "taskDocumentIncomplete", "taskId": task_id.as_str(), "fields": fields})
        }
        RuleViolation::RecordReadOnly { task_id } => json!({"kind": "recordReadOnly", "taskId": task_id.as_str()}),
        RuleViolation::InvalidRecord(reason) => json!({"kind": "invalidRecord", "reason": reason}),
        RuleViolation::StageLocked { stage_index, unlocked_stage } => {
            json!({ "kind": "stageLocked", "stageIndex": stage_index, "unlockedStage": unlocked_stage })
        }
        RuleViolation::NotFrontStage { stage_index, unlocked_stage } => {
            json!({ "kind": "notFrontStage", "stageIndex": stage_index, "unlockedStage": unlocked_stage })
        }
        RuleViolation::StageIncomplete { stage_index, remaining } => {
            json!({ "kind": "stageIncomplete", "stageIndex": stage_index, "remaining": remaining })
        }
        RuleViolation::LastStage { stage_index } => json!({ "kind": "lastStage", "stageIndex": stage_index }),
        RuleViolation::OutOfOrder { task_id, expected } => {
            json!({ "kind": "outOfOrder", "taskId": task_id.as_str(), "expected": expected.as_str() })
        }
        RuleViolation::NotLastCompleted { task_id, last } => {
            json!({ "kind": "notLastCompleted", "taskId": task_id.as_str(), "last": last.as_str() })
        }
        RuleViolation::ReworkNotDone { task_id } => json!({ "kind": "reworkNotDone", "taskId": task_id.as_str() }),
        RuleViolation::ReworkReasonRequired => json!({ "kind": "reworkReasonRequired" }),
    }
}

impl From<ApplicationError> for ApiError {
    fn from(error: ApplicationError) -> Self {
        let message = error.to_string();
        match &error {
            ApplicationError::NotFound { .. } => {
                Self { status: StatusCode::NOT_FOUND, code: "notFound", message, details: None }
            }
            ApplicationError::Invalid(_) => Self::bad_request(message),
            ApplicationError::Conflict(_) => {
                Self { status: StatusCode::CONFLICT, code: "conflict", message, details: None }
            }
            ApplicationError::Unauthenticated => {
                Self { status: StatusCode::UNAUTHORIZED, code: "unauthenticated", message, details: None }
            }
            ApplicationError::InvalidCredentials => {
                Self { status: StatusCode::UNAUTHORIZED, code: "invalidCredentials", message, details: None }
            }
            ApplicationError::TooManyAttempts => {
                Self { status: StatusCode::TOO_MANY_REQUESTS, code: "tooManyAttempts", message, details: None }
            }
            ApplicationError::Forbidden(_) => {
                Self { status: StatusCode::FORBIDDEN, code: "forbidden", message, details: None }
            }
            ApplicationError::Rule(violation) => Self {
                status: StatusCode::CONFLICT,
                code: "ruleViolation",
                message,
                details: Some(rule_details(violation)),
            },
            ApplicationError::VersionConflict { expected } => Self {
                status: StatusCode::CONFLICT,
                code: "versionConflict",
                message,
                details: Some(json!({ "expectedVersion": expected })),
            },
            ApplicationError::Repository(_) | ApplicationError::External(_) => {
                tracing::error!(error = %error, "요청 처리 중 내부 오류");
                Self {
                    status: StatusCode::INTERNAL_SERVER_ERROR,
                    code: "internal",
                    message: "서버 내부 오류가 발생했습니다".into(),
                    details: None,
                }
            }
        }
    }
}
