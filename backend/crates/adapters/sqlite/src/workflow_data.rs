use std::collections::BTreeMap;

use process_flow_application::RepositoryError;
use process_flow_application::ports::RepoResult;
use process_flow_domain::TaskId;
use process_flow_domain::workflow::{
    Event, Evidence, FileEvidence, LinkEvidence, Phase, ReviewStatus, TaskDocument, TaskRecord,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::schema::{decode, encode, integer, stored_integer};

pub(crate) fn encode_phase(phase: Phase) -> RepoResult<(&'static str, i64, i64)> {
    let (kind, stage, completed) = match phase {
        Phase::Working { stage_index, completed } => ("working", stage_index, completed),
        Phase::AwaitingApproval { stage_index } => ("awaitingApproval", stage_index, 0),
        Phase::Finished => ("finished", 0, 0),
    };
    Ok((kind, integer(stage, "phase stage")?, integer(completed, "phase completed")?))
}

pub(crate) fn decode_phase(kind: &str, stage: i64, completed: i64) -> RepoResult<Phase> {
    match kind {
        "working" => Ok(Phase::Working {
            stage_index: stored_integer(stage, "phase stage")?,
            completed: stored_integer(completed, "phase completed")?,
        }),
        "awaitingApproval" => Ok(Phase::AwaitingApproval { stage_index: stored_integer(stage, "phase stage")? }),
        "finished" => Ok(Phase::Finished),
        _ => Err(RepositoryError::Corrupted(format!("Invalid phase: {kind}"))),
    }
}

#[derive(Serialize, Deserialize)]
struct DocumentData {
    version: u32,
    answers: BTreeMap<String, String>,
    review_status: String,
}

impl From<&TaskDocument> for DocumentData {
    fn from(document: &TaskDocument) -> Self {
        Self {
            version: document.version,
            answers: document.answers.clone(),
            review_status: match document.review_status {
                ReviewStatus::Pending => "pending",
                ReviewStatus::Passed => "passed",
                ReviewStatus::Blocked => "blocked",
            }
            .into(),
        }
    }
}

impl TryFrom<DocumentData> for TaskDocument {
    type Error = RepositoryError;

    fn try_from(value: DocumentData) -> Result<Self, Self::Error> {
        let review_status = match value.review_status.as_str() {
            "pending" => ReviewStatus::Pending,
            "passed" => ReviewStatus::Passed,
            "blocked" => ReviewStatus::Blocked,
            _ => {
                return Err(RepositoryError::Corrupted(
                    "invalid document version, review status, or answer length".into(),
                ));
            }
        };
        Ok(Self { version: value.version, answers: value.answers, review_status })
    }
}

#[derive(Serialize, Deserialize)]
struct EvidenceData {
    id: String,
    kind: String,
    title: String,
    description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base64: Option<String>,
}

impl From<&Evidence> for EvidenceData {
    fn from(value: &Evidence) -> Self {
        match value {
            Evidence::Link(item) => Self {
                id: item.id.clone(),
                kind: "link".into(),
                title: item.title.clone(),
                description: item.description.clone(),
                url: Some(item.url.clone()),
                file_name: None,
                media_type: None,
                size: None,
                base64: None,
            },
            Evidence::File(item) => Self {
                id: item.id.clone(),
                kind: "file".into(),
                title: item.title.clone(),
                description: item.description.clone(),
                url: None,
                file_name: Some(item.file_name.clone()),
                media_type: item.media_type.clone(),
                size: Some(item.size),
                base64: Some(item.base64.clone()),
            },
        }
    }
}

impl TryFrom<EvidenceData> for Evidence {
    type Error = RepositoryError;

    fn try_from(value: EvidenceData) -> Result<Self, Self::Error> {
        let invalid = |reason: &str| RepositoryError::Corrupted(reason.into());
        match value.kind.as_str() {
            "link"
                if value.file_name.is_none()
                    && value.media_type.is_none()
                    && value.size.is_none()
                    && value.base64.is_none() =>
            {
                Ok(Self::Link(LinkEvidence {
                    id: value.id,
                    title: value.title,
                    description: value.description,
                    url: value
                        .url
                        .ok_or_else(|| invalid("link evidence requires a safe HTTP(S) URL and no file data"))?,
                }))
            }
            "file" if value.url.is_none() => Ok(Self::File(FileEvidence {
                id: value.id,
                title: value.title,
                description: value.description,
                file_name: value.file_name.ok_or_else(|| invalid("file evidence needs a safe filename and no URL"))?,
                media_type: value.media_type,
                size: value.size.ok_or_else(|| invalid("file size does not match decoded bytes"))?,
                base64: value.base64.ok_or_else(|| invalid("file must be canonical base64 and at most 2 MiB"))?,
            })),
            "link" => Err(invalid("link evidence requires a safe HTTP(S) URL and no file data")),
            "file" => Err(invalid("file evidence needs a safe filename and no URL")),
            _ => Err(invalid("unknown evidence kind")),
        }
    }
}

pub(crate) fn task_document_json(record: &TaskRecord) -> RepoResult<Option<String>> {
    record.document.as_ref().map(|document| encode(&DocumentData::from(document))).transpose()
}

pub(crate) fn task_evidence_json(record: &TaskRecord) -> RepoResult<Option<String>> {
    record.evidence.as_ref().map(|items| encode(&evidence_data(items))).transpose()
}

fn evidence_data(items: &[Evidence]) -> Vec<EvidenceData> {
    items.iter().map(EvidenceData::from).collect()
}

#[derive(sqlx::FromRow)]
pub(crate) struct TaskRecordRow {
    task_id: String,
    link: String,
    note: String,
    document: Option<String>,
    evidence: Option<String>,
}

impl TaskRecordRow {
    pub(crate) fn into_domain(self) -> RepoResult<(TaskId, TaskRecord)> {
        let document =
            self.document.as_deref().map(decode::<DocumentData>).transpose()?.map(TryInto::try_into).transpose()?;
        let evidence = self
            .evidence
            .as_deref()
            .map(decode::<Vec<EvidenceData>>)
            .transpose()?
            .map(|items| items.into_iter().map(TryInto::try_into).collect::<RepoResult<_>>())
            .transpose()?;
        Ok((self.task_id.into(), TaskRecord { link: self.link, note: self.note, document, evidence }))
    }
}

pub(crate) fn event_payload(event: &Event) -> Value {
    match event {
        Event::TaskCompleted { task_id, record } | Event::RecordUpdated { task_id, record } => {
            let mut payload = json!({ "task": task_id.as_str(), "link": record.link, "note": record.note });
            if let Some(document) = &record.document {
                payload["document"] = json!(DocumentData::from(document));
            }
            if let Some(evidence) = &record.evidence {
                payload["evidence"] = json!(evidence_data(evidence));
            }
            payload
        }
        Event::TaskReopened { task_id } => json!({ "task": task_id.as_str() }),
        Event::StageApproved { stage_index } | Event::ApprovalRevoked { stage_index } => {
            json!({ "stage_index": stage_index })
        }
        Event::ReworkRequested { task_id, until_number, reason } => {
            json!({ "task": task_id.as_str(), "until_number": until_number, "reason": reason })
        }
        Event::ReworkCompleted => json!({}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stored_unknown_review_status_is_corruption() {
        let row = TaskRecordRow {
            task_id: "goals".into(),
            link: String::new(),
            note: String::new(),
            document: Some(r#"{"version":1,"answers":{},"review_status":"unknown"}"#.into()),
            evidence: None,
        };
        assert!(matches!(row.into_domain(), Err(RepositoryError::Corrupted(_))));
    }

    #[test]
    fn stored_mixed_evidence_variants_are_corruption() {
        let row = TaskRecordRow {
            task_id: "goals".into(), link: String::new(), note: String::new(), document: None,
            evidence: Some(r#"[{"id":"link","kind":"link","title":"Reference","description":"","url":"https://example.com","base64":"YQ=="}]"#.into()),
        };
        assert!(matches!(row.into_domain(), Err(RepositoryError::Corrupted(_))));
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;

    #[test]
    fn valid_record_and_event_json_preserve_optional_fields() {
        for status in ["pending", "passed", "blocked"] {
            for media in [None, Some(""), Some("text/plain")] {
                let document = json!({"version":1,"answers":{"answer":"value"},"review_status":status});
                let mut file = json!({"id":"file","kind":"file","title":"File","description":"Proof","file_name":"proof.txt","size":1,"base64":"YQ=="});
                if let Some(media) = media {
                    file["media_type"] = json!(media);
                }
                let evidence = json!([{"id":"link","kind":"link","title":"Link","description":"Reference","url":"https://example.com"},file]);
                let row = TaskRecordRow {
                    task_id: "goals".into(),
                    link: String::new(),
                    note: String::new(),
                    document: Some(document.to_string()),
                    evidence: Some(evidence.to_string()),
                };
                let (task_id, record) = row.into_domain().unwrap();
                let stored_document: Value =
                    serde_json::from_str(&task_document_json(&record).unwrap().unwrap()).unwrap();
                let stored_evidence: Value =
                    serde_json::from_str(&task_evidence_json(&record).unwrap().unwrap()).unwrap();
                assert_eq!(stored_document, document);
                assert_eq!(stored_evidence, evidence);
                let event = event_payload(&Event::RecordUpdated { task_id, record });
                assert_eq!(event["document"], document);
                assert_eq!(event["evidence"], evidence);
            }
        }
    }
}
