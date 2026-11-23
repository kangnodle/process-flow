use async_trait::async_trait;
use process_flow_application::ports::{ProjectRepository, RepoResult};
use process_flow_domain::membership::Role;
use process_flow_domain::project::Project;
use process_flow_domain::{ProjectId, UserId};
use sqlx::SqlitePool;

use crate::membership_store::put_membership;
use crate::schema::{backend, encode, integer, require_version, stored_integer, write_error};
use crate::search_store::enqueue_project_deletions;

#[derive(Debug, Clone)]
pub struct SqliteProjectStore {
    pool: SqlitePool,
}

impl SqliteProjectStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: String,
    name: String,
    description: String,
    archived: bool,
    version: i64,
}

impl ProjectRow {
    fn into_domain(self) -> RepoResult<Project> {
        Ok(Project {
            id: self.id.into(),
            name: self.name,
            description: self.description,
            archived: self.archived,
            version: stored_integer(self.version, "project version")?,
        })
    }
}

#[async_trait]
impl ProjectRepository for SqliteProjectStore {
    async fn insert(&self, project: &Project, owner: Option<&UserId>, created_at_ms: i64) -> RepoResult<()> {
        let mut transaction = self.pool.begin().await.map_err(backend)?;
        sqlx::query(
            "INSERT INTO projects (id, name, description, archived, version, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
        )
        .bind(project.id.as_str())
        .bind(&project.name)
        .bind(&project.description)
        .bind(project.archived)
        .bind(integer(project.version, "project version")?)
        .bind(created_at_ms)
        .execute(&mut *transaction)
        .await
        .map_err(|error| write_error(error, project.id.as_str()))?;
        if let Some(owner) = owner {
            put_membership(&mut transaction, &project.id, owner, Role::Owner, created_at_ms).await?;
        }
        transaction.commit().await.map_err(backend)
    }

    async fn find(&self, id: &ProjectId) -> RepoResult<Option<Project>> {
        sqlx::query_as::<_, ProjectRow>("SELECT id, name, description, archived, version FROM projects WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(backend)?
            .map(ProjectRow::into_domain)
            .transpose()
    }

    async fn find_many(&self, ids: &[ProjectId]) -> RepoResult<Vec<Project>> {
        let keys = encode(&ids.iter().map(ProjectId::as_str).collect::<Vec<_>>())?;
        sqlx::query_as::<_, ProjectRow>(
            "SELECT p.id, p.name, p.description, p.archived, p.version
             FROM json_each(?) requested JOIN projects p ON p.id = requested.value ORDER BY requested.key",
        )
        .bind(keys)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(ProjectRow::into_domain)
        .collect()
    }

    async fn list(&self, include_archived: bool) -> RepoResult<Vec<Project>> {
        sqlx::query_as::<_, ProjectRow>(
            "SELECT id, name, description, archived, version FROM projects
             WHERE ? OR archived = 0 ORDER BY created_at_ms, id",
        )
        .bind(include_archived)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(ProjectRow::into_domain)
        .collect()
    }

    async fn delete_archived(&self, id: &ProjectId, expected_version: u64) -> RepoResult<()> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(backend)?;
        let version = i64::try_from(expected_version).unwrap_or(-1);
        let available = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id = ? AND archived = 1 AND version = ?)",
        )
        .bind(id.as_str())
        .bind(version)
        .fetch_one(&mut *transaction)
        .await
        .map_err(backend)?;
        if !available {
            return Err(process_flow_application::RepositoryError::VersionConflict { expected: expected_version });
        }
        enqueue_project_deletions(&mut transaction, id).await?;
        let result = sqlx::query("DELETE FROM projects WHERE id = ? AND archived = 1 AND version = ?")
            .bind(id.as_str())
            .bind(version)
            .execute(&mut *transaction)
            .await
            .map_err(backend)?;
        require_version(result, expected_version)?;
        transaction.commit().await.map_err(backend)
    }

    async fn update(&self, project: &Project, expected_version: u64, updated_at_ms: i64) -> RepoResult<()> {
        let result = sqlx::query(
            "UPDATE projects SET name = ?, description = ?, archived = ?, version = ?, updated_at_ms = ?
             WHERE id = ? AND version = ?",
        )
        .bind(&project.name)
        .bind(&project.description)
        .bind(project.archived)
        .bind(integer(project.version, "project version")?)
        .bind(updated_at_ms)
        .bind(project.id.as_str())
        .bind(i64::try_from(expected_version).unwrap_or(-1))
        .execute(&self.pool)
        .await
        .map_err(backend)?;
        require_version(result, expected_version)
    }
}
