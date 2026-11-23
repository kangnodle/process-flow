use std::collections::BTreeSet;

use super::{Evidence, ReviewStatus, TaskRecord, WorkflowState};
use crate::{RuleViolation, TaskId};

#[derive(Debug, Clone, Copy)]
pub struct TaskField {
    pub id: &'static str,
    pub allow_not_applicable: bool,
}

#[path = "task_forms.rs"]
mod task_forms;

use task_forms::TASK_FORMS;

pub fn task_form(task_id: &str) -> &'static [TaskField] {
    TASK_FORMS.iter().find(|(id, _)| *id == task_id).map_or(&[], |(_, fields)| *fields)
}

fn meaningful(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    ![
        "tbd",
        "todo",
        "pending",
        "n/a",
        "na",
        "none",
        "null",
        "undefined",
        "미정",
        "추후",
        "작성 예정",
        "해당 없음",
        "없음",
    ]
    .contains(&normalized.as_str())
        && normalized.chars().any(char::is_alphanumeric)
}

pub fn validate_task_document(task_id: &str, record: &TaskRecord) -> Vec<String> {
    let fields = task_form(task_id);
    if fields.is_empty() {
        return Vec::new();
    }
    let document = record.document.as_ref().filter(|d| d.version == 1);
    let mut invalid: Vec<String> = fields
        .iter()
        .filter(|field| {
            let value = document.and_then(|d| d.answers.get(field.id)).map_or("", String::as_str).trim();
            let normalized = value.to_lowercase();
            if let Some(suffix) = normalized.strip_prefix("n/a").or_else(|| normalized.strip_prefix("해당 없음")) {
                let suffix = suffix.trim_start();
                if let Some(reason) = suffix.strip_prefix([':', '：', '-']) {
                    return !field.allow_not_applicable || !meaningful(reason);
                }
            }
            !meaningful(value)
        })
        .map(|field| field.id.to_owned())
        .collect();
    if record.document.as_ref().is_none_or(|d| d.review_status != ReviewStatus::Passed) {
        invalid.push("reviewStatus".into());
    }
    invalid
}

pub(super) fn require_document(task_id: &TaskId, record: &TaskRecord) -> Result<(), RuleViolation> {
    let fields = validate_task_document(task_id.as_str(), record);
    if fields.is_empty() {
        Ok(())
    } else {
        Err(RuleViolation::TaskDocumentIncomplete { task_id: task_id.clone(), fields })
    }
}

fn invalid(reason: &str) -> RuleViolation {
    RuleViolation::InvalidRecord(reason.into())
}

fn safe_url(value: &str) -> bool {
    if value.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return false;
    }
    let Some((scheme, rest)) = value.split_once("://") else {
        return false;
    };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains('@') {
        return false;
    }
    let (host, port) = if let Some(ipv6) = authority.strip_prefix('[') {
        let Some((address, suffix)) = ipv6.split_once(']') else {
            return false;
        };
        if address.parse::<std::net::Ipv6Addr>().is_err() {
            return false;
        }
        if suffix.is_empty() {
            return true;
        }
        let Some(port) = suffix.strip_prefix(':') else {
            return false;
        };
        return port.parse::<u16>().is_ok();
    } else {
        authority.rsplit_once(':').map_or((authority, None), |(host, port)| (host, Some(port)))
    };
    !host.is_empty()
        && host
            .split('.')
            .all(|label| !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        && port.is_none_or(|port| port.parse::<u16>().is_ok())
}

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_WORKFLOW_BYTES: usize = 8 * 1024 * 1024;

fn base64_size(value: &str) -> Option<usize> {
    let bytes = value.as_bytes();
    if bytes.len() > MAX_FILE_BYTES.div_ceil(3) * 4 || !bytes.len().is_multiple_of(4) {
        return None;
    }
    if bytes.is_empty() {
        return Some(0);
    }
    let padding = bytes.iter().rev().take_while(|&&b| b == b'=').count();
    if padding > 2 {
        return None;
    }
    let sextet = |b: u8| match b {
        b'A'..=b'Z' => Some(b - b'A'),
        b'a'..=b'z' => Some(b - b'a' + 26),
        b'0'..=b'9' => Some(b - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    };
    let content = &bytes[..bytes.len() - padding];
    if content.iter().any(|&b| sextet(b).is_none()) {
        return None;
    }
    let tail = sextet(*content.last()?)?;
    if (padding == 2 && tail & 15 != 0) || (padding == 1 && tail & 3 != 0) {
        return None;
    }
    let size = bytes.len() / 4 * 3 - padding;
    (size <= MAX_FILE_BYTES).then_some(size)
}

fn validate_evidence(item: &Evidence) -> Result<usize, RuleViolation> {
    if item.id().trim().is_empty()
        || item.id().len() > 128
        || item.id().chars().any(char::is_control)
        || item.title().trim().is_empty()
        || item.title().len() > 512
        || item.description().len() > 16_384
    {
        return Err(invalid("evidence needs an ID and title within text limits"));
    }
    match item {
        Evidence::Link(item) => {
            if item.url.len() > 8192 || !safe_url(&item.url) {
                return Err(invalid("link evidence requires a safe HTTP(S) URL and no file data"));
            }
            Ok(0)
        }
        Evidence::File(item) => {
            let name = item.file_name.as_str();
            if name.trim().is_empty()
                || name.len() > 255
                || name == "."
                || name == ".."
                || name.chars().any(|c| c.is_control() || c == '/' || c == '\\')
            {
                return Err(invalid("file evidence needs a safe filename and no URL"));
            }
            if item.media_type.as_ref().is_some_and(|mime| mime.len() > 255 || mime.chars().any(char::is_control)) {
                return Err(invalid("invalid file media type"));
            }
            let size =
                base64_size(&item.base64).ok_or_else(|| invalid("file must be canonical base64 and at most 2 MiB"))?;
            if item.size != size as u64 {
                return Err(invalid("file size does not match decoded bytes"));
            }
            Ok(size)
        }
    }
}

pub(super) fn validate_record(
    state: &WorkflowState,
    task_id: &TaskId,
    record: &TaskRecord,
) -> Result<(), RuleViolation> {
    if record.link.len() > 8192 || record.note.len() > 262_144 {
        return Err(invalid("legacy record text is too long"));
    }
    if let Some(document) = &record.document
        && (document.version != 1
            || document.answers.len() > 100
            || document.answers.iter().any(|(k, v)| k.len() > 128 || v.len() > 65_536))
    {
        return Err(invalid("invalid document version, review status, or answer length"));
    }
    let evidence = record.evidence.as_deref().unwrap_or_default();
    if evidence.len() > 20 {
        return Err(invalid("at most 20 evidence items per task"));
    }
    let mut ids = BTreeSet::new();
    let mut total = 0usize;
    for item in evidence {
        if !ids.insert(item.id()) {
            return Err(invalid("duplicate evidence ID"));
        }
        total += validate_evidence(item)?;
    }
    for (_, other) in state.records.iter().filter(|(id, _)| *id != task_id) {
        for item in other.evidence.iter().flatten() {
            if let Evidence::File(item) = item {
                total = total
                    .checked_add(base64_size(&item.base64).ok_or_else(|| invalid("stored evidence is invalid"))?)
                    .ok_or_else(|| invalid("workflow evidence limit"))?;
            }
        }
    }

    if total > MAX_WORKFLOW_BYTES {
        return Err(invalid("workflow files exceed 8 MiB"));
    }
    Ok(())
}
