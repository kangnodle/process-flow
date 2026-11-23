use async_trait::async_trait;
use process_flow_application::ports::RepoResult;
use process_flow_application::search::{SearchDocument, SearchJob, SearchJobs, SearchKey, SearchSource};
use process_flow_domain::ProjectId;
use sqlx::{SqliteConnection, SqlitePool};

use crate::schema::{backend, stored_integer};

#[derive(Debug, Clone)]
pub struct SqliteSearchStore {
    pool: SqlitePool,
}

impl SqliteSearchStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn enqueue_deletion(&self, key: &SearchKey) -> RepoResult<bool> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(backend)?;
        let superseded = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(
                 SELECT 1 FROM task_records WHERE workflow_id = ?1 AND task_id = ?2 AND search_revision IS NOT NULL
                 UNION ALL
                 SELECT 1 FROM search_jobs WHERE workflow_id = ?1 AND task_id = ?2
             )",
        )
        .bind(key.workflow_id.as_str())
        .bind(key.task_id.as_str())
        .fetch_one(&mut *transaction)
        .await
        .map_err(backend)?;
        if superseded {
            transaction.rollback().await.map_err(backend)?;
            return Ok(false);
        }
        replace_job(&mut transaction, key, "").await?;
        transaction.commit().await.map_err(backend)?;
        Ok(true)
    }
}

#[derive(sqlx::FromRow)]
struct DocumentRow {
    workflow_id: String,
    task_id: String,
    revision: i64,
    text: String,
}

impl DocumentRow {
    fn into_document(self) -> RepoResult<SearchDocument> {
        Ok(SearchDocument {
            key: SearchKey { workflow_id: self.workflow_id.into(), task_id: self.task_id.into() },
            revision: stored_integer(self.revision, "search revision")?,
            text: self.text,
        })
    }
}

#[derive(sqlx::FromRow)]
struct JobRow {
    id: i64,
    #[sqlx(flatten)]
    document: DocumentRow,
    attempts: i64,
}

pub(crate) async fn replace_job(connection: &mut SqliteConnection, key: &SearchKey, text: &str) -> RepoResult<i64> {
    let revision = sqlx::query_scalar::<_, i64>(
        "UPDATE search_revision SET value = value + 1 WHERE singleton = 1 RETURNING value",
    )
    .fetch_one(&mut *connection)
    .await
    .map_err(backend)?;
    sqlx::query("INSERT OR REPLACE INTO search_jobs (workflow_id, task_id, revision, text) VALUES (?, ?, ?, ?)")
        .bind(key.workflow_id.as_str())
        .bind(key.task_id.as_str())
        .bind(revision)
        .bind(text)
        .execute(connection)
        .await
        .map_err(backend)?;
    Ok(revision)
}

pub(crate) async fn enqueue_project_deletions(
    connection: &mut SqliteConnection,
    project_id: &ProjectId,
) -> RepoResult<()> {
    let keys = sqlx::query_as::<_, (String, String)>(
        "SELECT r.workflow_id, r.task_id FROM task_records r
         JOIN workflows w ON w.id = r.workflow_id
         WHERE w.project_id = ? AND r.search_revision IS NOT NULL
         ORDER BY r.workflow_id, r.task_id",
    )
    .bind(project_id.as_str())
    .fetch_all(&mut *connection)
    .await
    .map_err(backend)?;
    for (workflow_id, task_id) in keys {
        let key = SearchKey { workflow_id: workflow_id.into(), task_id: task_id.into() };
        replace_job(connection, &key, "").await?;
    }
    Ok(())
}

#[async_trait]
impl SearchSource for SqliteSearchStore {
    async fn current(&self, key: &SearchKey) -> RepoResult<Option<SearchDocument>> {
        sqlx::query_as::<_, DocumentRow>(
            "SELECT workflow_id, task_id, search_revision AS revision, search_text AS text FROM task_records
             WHERE workflow_id = ? AND task_id = ? AND search_revision IS NOT NULL",
        )
        .bind(key.workflow_id.as_str())
        .bind(key.task_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?
        .map(DocumentRow::into_document)
        .transpose()
    }

    async fn page(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        let fields = "SELECT workflow_id, task_id, search_revision AS revision, search_text AS text FROM task_records";
        let base = format!("{fields} WHERE search_revision IS NOT NULL ORDER BY workflow_id, task_id LIMIT ?");
        let paged = format!(
            "{fields} WHERE search_revision IS NOT NULL AND (workflow_id, task_id) > (?, ?)
             ORDER BY workflow_id, task_id LIMIT ?"
        );
        let query = match after {
            Some(key) => {
                sqlx::query_as::<_, DocumentRow>(&paged).bind(key.workflow_id.as_str()).bind(key.task_id.as_str())
            }
            None => sqlx::query_as::<_, DocumentRow>(&base),
        };
        query
            .bind(i64::try_from(limit).unwrap_or(i64::MAX))
            .fetch_all(&self.pool)
            .await
            .map_err(backend)?
            .into_iter()
            .map(DocumentRow::into_document)
            .collect()
    }

    async fn enqueue(&self, document: &SearchDocument) -> RepoResult<bool> {
        if document.text.is_empty() {
            return self.enqueue_deletion(&document.key).await;
        }
        let Ok(revision) = i64::try_from(document.revision) else { return Ok(false) };
        let result = sqlx::query(
            "INSERT INTO search_jobs (workflow_id, task_id, revision, text)
             SELECT workflow_id, task_id, search_revision, search_text FROM task_records
             WHERE workflow_id = ? AND task_id = ? AND search_revision = ? AND search_text = ?
             ON CONFLICT (workflow_id, task_id) DO NOTHING",
        )
        .bind(document.key.workflow_id.as_str())
        .bind(document.key.task_id.as_str())
        .bind(revision)
        .bind(&document.text)
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        Ok(result.rows_affected() == 1)
    }
}

#[async_trait]
impl SearchJobs for SqliteSearchStore {
    async fn pending(&self, now_ms: i64, limit: usize) -> RepoResult<Vec<SearchJob>> {
        sqlx::query_as::<_, JobRow>(
            "SELECT id, workflow_id, task_id, revision, text, attempts FROM search_jobs WHERE available_at_ms <= ?
             ORDER BY available_at_ms, id LIMIT ?",
        )
        .bind(now_ms)
        .bind(i64::try_from(limit).unwrap_or(i64::MAX))
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(|row| {
            Ok(SearchJob {
                id: stored_integer(row.id, "search job id")?,
                document: row.document.into_document()?,
                attempts: stored_integer(row.attempts, "search job attempts")?,
            })
        })
        .collect()
    }

    async fn acknowledge(&self, job: &SearchJob) -> RepoResult<()> {
        sqlx::query("DELETE FROM search_jobs WHERE id = ? AND revision = ?")
            .bind(i64::try_from(job.id).unwrap_or(-1))
            .bind(i64::try_from(job.document.revision).unwrap_or(-1))
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn retry(&self, job: &SearchJob, available_at_ms: i64) -> RepoResult<()> {
        sqlx::query(
            "UPDATE search_jobs SET attempts = MIN(attempts + 1, 4294967295), available_at_ms = ?
             WHERE id = ? AND revision = ? AND attempts = ?",
        )
        .bind(available_at_ms)
        .bind(i64::try_from(job.id).unwrap_or(-1))
        .bind(i64::try_from(job.document.revision).unwrap_or(-1))
        .bind(i64::from(job.attempts))
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        Ok(())
    }
}
