use std::collections::{BTreeMap, BTreeSet};

use async_trait::async_trait;
use process_flow_application::ports::{AssignmentRepository, RepoResult};
use process_flow_domain::assignment::{Assignments, StageAssignment};
use process_flow_domain::{UserId, WorkflowId};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::schema::{backend, decode, encode, integer, require_version, stored_integer};

#[derive(Debug, Clone)]
pub struct SqliteAssignmentStore {
    pool: SqlitePool,
}

impl SqliteAssignmentStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(Serialize, Deserialize)]
struct AssignmentData {
    stages: BTreeMap<String, StageData>,
    tasks: BTreeMap<String, BTreeSet<String>>,
}

#[derive(Serialize, Deserialize)]
struct StageData {
    accountable: Option<String>,
    responsible: BTreeSet<String>,
    consulted: BTreeSet<String>,
    informed: BTreeSet<String>,
}

fn restore_assignments(version: i64, content: &str) -> RepoResult<Assignments> {
    let data: AssignmentData = decode(content)?;
    Ok(Assignments {
        stages: data.stages.into_iter().map(|(id, stage)| (id.into(), stage.into())).collect(),
        tasks: data.tasks.into_iter().map(|(id, users)| (id.into(), restore_users(users))).collect(),
        version: stored_integer(version, "assignment version")?,
    })
}

impl From<StageData> for StageAssignment {
    fn from(stage: StageData) -> Self {
        Self {
            accountable: stage.accountable.map(Into::into),
            responsible: restore_users(stage.responsible),
            consulted: restore_users(stage.consulted),
            informed: restore_users(stage.informed),
        }
    }
}

impl From<&StageAssignment> for StageData {
    fn from(stage: &StageAssignment) -> Self {
        Self {
            accountable: stage.accountable.as_ref().map(ToString::to_string),
            responsible: store_users(&stage.responsible),
            consulted: store_users(&stage.consulted),
            informed: store_users(&stage.informed),
        }
    }
}

fn restore_users(ids: BTreeSet<String>) -> BTreeSet<UserId> {
    ids.into_iter().map(Into::into).collect()
}

fn store_users(ids: &BTreeSet<UserId>) -> BTreeSet<String> {
    ids.iter().map(ToString::to_string).collect()
}

pub(crate) fn assignment_content(assignments: &Assignments) -> RepoResult<String> {
    encode(&AssignmentData {
        stages: assignments.stages.iter().map(|(id, stage)| (id.to_string(), stage.into())).collect(),
        tasks: assignments.tasks.iter().map(|(id, users)| (id.to_string(), store_users(users))).collect(),
    })
}

#[async_trait]
impl AssignmentRepository for SqliteAssignmentStore {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<Assignments> {
        sqlx::query_as::<_, (i64, String)>("SELECT version, content FROM workflow_assignments WHERE workflow_id = ?")
            .bind(workflow_id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(backend)?
            .map_or_else(|| Ok(Assignments::default()), |(version, content)| restore_assignments(version, &content))
    }

    async fn find_many(&self, workflow_ids: &[WorkflowId]) -> RepoResult<BTreeMap<WorkflowId, Assignments>> {
        let keys = encode(&workflow_ids.iter().map(WorkflowId::as_str).collect::<Vec<_>>())?;
        sqlx::query_as::<_, (String, i64, String)>(
            "SELECT a.workflow_id, a.version, a.content
             FROM json_each(?) requested JOIN workflow_assignments a ON a.workflow_id = requested.value",
        )
        .bind(keys)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(|(id, version, content)| Ok((id.into(), restore_assignments(version, &content)?)))
        .collect()
    }

    async fn save(
        &self,
        workflow_id: &WorkflowId,
        assignments: &Assignments,
        expected_version: u64,
        changed_by: &UserId,
        now_ms: i64,
    ) -> RepoResult<()> {
        let version = integer(assignments.version, "assignment version")?;
        let content = assignment_content(assignments)?;
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let changed = sqlx::query(
            "INSERT INTO workflow_assignments (workflow_id, version, content, updated_at_ms)
             SELECT ?1, ?2, ?3, ?4
             WHERE COALESCE((SELECT version FROM workflow_assignments WHERE workflow_id = ?1), 0) = ?5
             ON CONFLICT (workflow_id) DO UPDATE SET
                 version = excluded.version, content = excluded.content, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(workflow_id.as_str())
        .bind(version)
        .bind(&content)
        .bind(now_ms)
        .bind(i64::try_from(expected_version).unwrap_or(-1))
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        if let Err(conflict) = require_version(changed, expected_version) {
            let workflow_exists = sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM workflows WHERE id = ?)")
                .bind(workflow_id.as_str())
                .fetch_one(&mut *transaction)
                .await
                .map_err(backend)?;
            return Err(if workflow_exists {
                conflict
            } else {
                backend(format!("Workflow unavailable: {workflow_id}"))
            });
        }
        sqlx::query(
            "INSERT INTO assignment_changes (workflow_id, version, changed_by, changed_at_ms, content)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(workflow_id.as_str())
        .bind(version)
        .bind(changed_by.as_str())
        .bind(now_ms)
        .bind(&content)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        transaction.commit().await.map_err(backend)
    }
}
