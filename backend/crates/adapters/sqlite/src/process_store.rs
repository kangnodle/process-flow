use async_trait::async_trait;
use process_flow_application::RepositoryError;
use process_flow_application::ports::{ProcessGraph, ProcessRepository, RepoResult};
use process_flow_domain::process::{Process, ProcessSpec, StageSpec, define_process};
use process_flow_domain::{ProcessId, TaskId};
use sqlx::SqlitePool;

use crate::schema::{backend, integer, stored_integer};

#[derive(Debug, Clone)]
pub struct SqliteProcessStore {
    pool: SqlitePool,
}

impl SqliteProcessStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct StageTaskRow {
    stage_id: Option<String>,
    position: Option<i64>,
    task_id: Option<String>,
    number: Option<i64>,
}

#[async_trait]
impl ProcessRepository for SqliteProcessStore {
    async fn find(&self, id: &ProcessId) -> RepoResult<Option<Process>> {
        let rows = sqlx::query_as::<_, StageTaskRow>(
            "SELECT stages.id AS stage_id, stages.position, tasks.id AS task_id, tasks.number
             FROM processes
             LEFT JOIN stages ON stages.process_id = processes.id
             LEFT JOIN tasks ON tasks.process_id = stages.process_id AND tasks.stage_id = stages.id
             WHERE processes.id = ? ORDER BY stages.position, tasks.number",
        )
        .bind(id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?;
        if rows.is_empty() {
            return Ok(None);
        }

        let mut stages: Vec<StageSpec> = Vec::new();
        for (offset, row) in rows.into_iter().enumerate() {
            let invalid = || RepositoryError::Corrupted(format!("Invalid stage or task ordering in process {id}"));
            let stage_id = row.stage_id.ok_or_else(invalid)?;
            let position = stored_integer::<usize>(row.position.ok_or_else(invalid)?, "stage position")?;
            if position == stages.len() {
                stages.push(StageSpec { id: stage_id.into(), tasks: Vec::new() });
            } else if position + 1 != stages.len() {
                return Err(invalid());
            }
            let number = stored_integer::<usize>(row.number.ok_or_else(invalid)?, "task number")?;
            if number != offset + 1 {
                return Err(invalid());
            }
            stages[position].tasks.push(row.task_id.ok_or_else(invalid)?.into());
        }
        define_process(ProcessSpec { id: id.clone(), stages })
            .map(Some)
            .map_err(|error| RepositoryError::Corrupted(error.to_string()))
    }

    async fn save(&self, process: &Process) -> RepoResult<()> {
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        let id = process.id().as_str();
        sqlx::query("INSERT INTO processes (id) VALUES (?) ON CONFLICT (id) DO NOTHING")
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(backend)?;
        sqlx::query("DELETE FROM stages WHERE process_id = ?")
            .bind(id)
            .execute(&mut *transaction)
            .await
            .map_err(backend)?;
        for stage in process.stages() {
            sqlx::query("INSERT INTO stages (process_id, id, position) VALUES (?, ?, ?)")
                .bind(id)
                .bind(stage.id.as_str())
                .bind(integer(stage.index, "stage position")?)
                .execute(&mut *transaction)
                .await
                .map_err(backend)?;
            for task in &stage.tasks {
                sqlx::query("INSERT INTO tasks (process_id, id, stage_id, number) VALUES (?, ?, ?, ?)")
                    .bind(id)
                    .bind(task.id.as_str())
                    .bind(stage.id.as_str())
                    .bind(integer(task.number, "task number")?)
                    .execute(&mut *transaction)
                    .await
                    .map_err(backend)?;
            }
        }
        transaction.commit().await.map_err(backend)
    }
}

#[async_trait]
impl ProcessGraph for SqliteProcessStore {
    async fn prerequisites(&self, process_id: &ProcessId, task_id: &TaskId) -> RepoResult<Vec<TaskId>> {
        let keys = sqlx::query_scalar::<_, String>(
            "SELECT predecessor.id
             FROM tasks target
             JOIN stages target_stage ON target_stage.process_id = target.process_id AND target_stage.id = target.stage_id
             JOIN stages earlier ON earlier.process_id = target.process_id AND earlier.position < target_stage.position
             JOIN tasks predecessor ON predecessor.process_id = earlier.process_id AND predecessor.stage_id = earlier.id
             WHERE target.process_id = ? AND target.id = ?
             ORDER BY predecessor.number",
        )
        .bind(process_id.as_str())
        .bind(task_id.as_str())
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?;
        Ok(keys.into_iter().map(TaskId::from).collect())
    }
}
