use std::collections::BTreeMap;

use async_trait::async_trait;
use process_flow_application::RepositoryError;
use process_flow_application::ports::{RecordedEvent, RepoResult, WorkflowRepository};
use process_flow_application::search::SearchKey;
use process_flow_domain::workflow::{Rework, Workflow, WorkflowState};
use process_flow_domain::{ProjectId, TaskId, WorkflowId};
use sqlx::{SqliteConnection, SqlitePool};

use crate::schema::{backend, encode, integer, require_version, stored_integer, write_error};
use crate::search_store::replace_job;
use crate::workflow_data::{
    TaskRecordRow, decode_phase, encode_phase, event_payload, task_document_json, task_evidence_json,
};

const WORKFLOW_FIELDS: &str = "id, project_id, process_id, name, phase_kind, phase_stage, phase_completed,
    rework_until, rework_reason, version";

#[derive(Debug, Clone)]
pub struct SqliteWorkflowStore {
    pool: SqlitePool,
}

impl SqliteWorkflowStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct WorkflowRow {
    id: String,
    project_id: String,
    process_id: String,
    name: String,
    phase_kind: String,
    phase_stage: i64,
    phase_completed: i64,
    rework_until: Option<i64>,
    rework_reason: Option<String>,
    version: i64,
}

impl WorkflowRow {
    fn into_domain(self) -> RepoResult<Workflow> {
        let rework = match (self.rework_until, self.rework_reason) {
            (Some(until), Some(reason)) => {
                Some(Rework { until_number: stored_integer(until, "rework until")?, reason })
            }
            (None, None) => None,
            _ => return Err(RepositoryError::Corrupted("Incomplete rework data".into())),
        };
        Ok(Workflow {
            id: self.id.into(),
            project_id: self.project_id.into(),
            process_id: self.process_id.into(),
            name: self.name,
            state: WorkflowState {
                phase: decode_phase(&self.phase_kind, self.phase_stage, self.phase_completed)?,
                rework,
                records: BTreeMap::new(),
            },
            version: stored_integer(self.version, "workflow version")?,
        })
    }
}

pub(crate) async fn reconcile_records(connection: &mut SqliteConnection, workflow: &Workflow) -> RepoResult<()> {
    let rows = sqlx::query_as::<_, (String, String, Option<i64>)>(
        "SELECT task_id, search_text, search_revision FROM task_records WHERE workflow_id = ?",
    )
    .bind(workflow.id.as_str())
    .fetch_all(&mut *connection)
    .await
    .map_err(backend)?;
    let mut previous: BTreeMap<TaskId, _> =
        rows.into_iter().map(|(task, text, revision)| (task.into(), (text, revision))).collect();
    for (task_id, record) in &workflow.state.records {
        let (old_text, old_revision) = previous.remove(task_id).unwrap_or_default();
        let text = record.searchable_text();
        let revision = if text == old_text {
            old_revision
        } else {
            let key = SearchKey { workflow_id: workflow.id.clone(), task_id: task_id.clone() };
            let revision = replace_job(connection, &key, &text).await?;
            (!text.is_empty()).then_some(revision)
        };
        sqlx::query(
            "INSERT INTO task_records (workflow_id, task_id, link, note, document, evidence, search_text, search_revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (workflow_id, task_id) DO UPDATE SET
                 link = excluded.link, note = excluded.note, document = excluded.document, evidence = excluded.evidence,
                 search_text = excluded.search_text, search_revision = excluded.search_revision
             WHERE task_records.link IS NOT excluded.link OR task_records.note IS NOT excluded.note
                OR task_records.document IS NOT excluded.document OR task_records.evidence IS NOT excluded.evidence
                OR task_records.search_revision IS NOT excluded.search_revision",
        )
        .bind(workflow.id.as_str())
        .bind(task_id.as_str())
        .bind(&record.link)
        .bind(&record.note)
        .bind(task_document_json(record)?)
        .bind(task_evidence_json(record)?)
        .bind(text)
        .bind(revision)
        .execute(&mut *connection)
        .await
        .map_err(backend)?;
    }
    for (task_id, (_, revision)) in previous {
        sqlx::query("DELETE FROM task_records WHERE workflow_id = ? AND task_id = ?")
            .bind(workflow.id.as_str())
            .bind(task_id.as_str())
            .execute(&mut *connection)
            .await
            .map_err(backend)?;
        if revision.is_some() {
            let key = SearchKey { workflow_id: workflow.id.clone(), task_id };
            replace_job(connection, &key, "").await?;
        }
    }
    Ok(())
}

async fn record_event(
    connection: &mut SqliteConnection,
    workflow_id: &WorkflowId,
    event: &RecordedEvent,
) -> RepoResult<()> {
    sqlx::query(
        "INSERT INTO workflow_events (workflow_id, version, occurred_at_ms, actor_id, authority, kind, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(workflow_id.as_str())
    .bind(integer(event.version, "workflow event version")?)
    .bind(event.occurred_at_ms)
    .bind(event.actor.as_str())
    .bind(event.authority.as_str())
    .bind(event.event.kind())
    .bind(encode(&event_payload(&event.event))?)
    .execute(connection)
    .await
    .map_err(backend)?;
    Ok(())
}

fn rework_fields(rework: Option<&Rework>) -> RepoResult<(Option<i64>, Option<&str>)> {
    match rework {
        Some(rework) => Ok((Some(integer(rework.until_number, "rework until")?), Some(rework.reason.as_str()))),
        None => Ok((None, None)),
    }
}

#[async_trait]
impl WorkflowRepository for SqliteWorkflowStore {
    async fn insert(&self, workflow: &Workflow, created_at_ms: i64) -> RepoResult<()> {
        let (phase, stage, completed) = encode_phase(workflow.state.phase)?;
        let (until, reason) = rework_fields(workflow.state.rework.as_ref())?;
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let result = sqlx::query(
            "INSERT INTO workflows (
                 id, project_id, process_id, name, phase_kind, phase_stage, phase_completed,
                 rework_until, rework_reason, version, created_at_ms, updated_at_ms
             )
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
             FROM projects WHERE id = ?2 AND archived = 0",
        )
        .bind(workflow.id.as_str())
        .bind(workflow.project_id.as_str())
        .bind(workflow.process_id.as_str())
        .bind(&workflow.name)
        .bind(phase)
        .bind(stage)
        .bind(completed)
        .bind(until)
        .bind(reason)
        .bind(integer(workflow.version, "workflow version")?)
        .bind(created_at_ms)
        .execute(&mut *transaction)
        .await
        .map_err(|error| write_error(error, workflow.id.as_str()))?;
        if result.rows_affected() == 0 {
            return Err(backend(format!("Project unavailable: {}", workflow.project_id)));
        }
        reconcile_records(&mut transaction, workflow).await?;
        transaction.commit().await.map_err(backend)
    }

    async fn find(&self, id: &WorkflowId) -> RepoResult<Option<Workflow>> {
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let query = format!("SELECT {WORKFLOW_FIELDS} FROM workflows WHERE id = ?");
        let row = sqlx::query_as::<_, WorkflowRow>(&query)
            .bind(id.as_str())
            .fetch_optional(&mut *transaction)
            .await
            .map_err(backend)?;
        let Some(row) = row else {
            transaction.commit().await.map_err(backend)?;
            return Ok(None);
        };
        let mut workflow = row.into_domain()?;
        let records = sqlx::query_as::<_, TaskRecordRow>(
            "SELECT task_id, link, note, document, evidence FROM task_records WHERE workflow_id = ?",
        )
        .bind(id.as_str())
        .fetch_all(&mut *transaction)
        .await
        .map_err(backend)?;
        workflow.state.records = records.into_iter().map(TaskRecordRow::into_domain).collect::<RepoResult<_>>()?;
        transaction.commit().await.map_err(backend)?;
        Ok(Some(workflow))
    }

    async fn list(&self, project_id: Option<&ProjectId>) -> RepoResult<Vec<Workflow>> {
        let all = format!("SELECT {WORKFLOW_FIELDS} FROM workflows ORDER BY created_at_ms DESC, id");
        let in_project =
            format!("SELECT {WORKFLOW_FIELDS} FROM workflows WHERE project_id = ? ORDER BY created_at_ms DESC, id");
        let query = match project_id {
            Some(id) => sqlx::query_as::<_, WorkflowRow>(&in_project).bind(id.as_str()),
            None => sqlx::query_as::<_, WorkflowRow>(&all),
        };
        query.fetch_all(&self.pool).await.map_err(backend)?.into_iter().map(WorkflowRow::into_domain).collect()
    }

    async fn list_in(&self, project_ids: &[ProjectId]) -> RepoResult<Vec<Workflow>> {
        let keys = encode(&project_ids.iter().map(ProjectId::as_str).collect::<Vec<_>>())?;
        let query = format!(
            "SELECT {WORKFLOW_FIELDS} FROM workflows
             WHERE project_id IN (SELECT value FROM json_each(?)) ORDER BY created_at_ms DESC, id"
        );
        sqlx::query_as::<_, WorkflowRow>(&query)
            .bind(keys)
            .fetch_all(&self.pool)
            .await
            .map_err(backend)?
            .into_iter()
            .map(WorkflowRow::into_domain)
            .collect()
    }

    async fn update(&self, workflow: &Workflow, expected_version: u64, events: &[RecordedEvent]) -> RepoResult<()> {
        let (phase, stage, completed) = encode_phase(workflow.state.phase)?;
        let (until, reason) = rework_fields(workflow.state.rework.as_ref())?;
        let updated_at = events.first().map_or(0, |event| event.occurred_at_ms);
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let changed = sqlx::query(
            "UPDATE workflows SET
                 name = ?, phase_kind = ?, phase_stage = ?, phase_completed = ?,
                 rework_until = ?, rework_reason = ?, version = ?, updated_at_ms = ?
             WHERE id = ? AND version = ?",
        )
        .bind(&workflow.name)
        .bind(phase)
        .bind(stage)
        .bind(completed)
        .bind(until)
        .bind(reason)
        .bind(integer(workflow.version, "workflow version")?)
        .bind(updated_at)
        .bind(workflow.id.as_str())
        .bind(i64::try_from(expected_version).unwrap_or(-1))
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        require_version(changed, expected_version)?;
        reconcile_records(&mut transaction, workflow).await?;
        for event in events {
            record_event(&mut transaction, &workflow.id, event).await?;
        }
        transaction.commit().await.map_err(backend)
    }
}
