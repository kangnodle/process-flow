use async_trait::async_trait;
use process_flow_application::RepositoryError;
use process_flow_application::ports::{MembershipRepository, RepoResult};
use process_flow_domain::membership::{Membership, Role};
use process_flow_domain::{ProjectId, UserId};
use sqlx::{SqliteConnection, SqlitePool};

use crate::schema::backend;

#[derive(Debug, Clone)]
pub struct SqliteMembershipStore {
    pool: SqlitePool,
}

impl SqliteMembershipStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    async fn select(&self, filter: &'static str, id: &str) -> RepoResult<Vec<Membership>> {
        let query = format!(
            "SELECT project_id, user_id, role FROM memberships
             WHERE {filter} = ? ORDER BY created_at_ms, project_id, user_id"
        );
        sqlx::query_as::<_, MembershipRow>(&query)
            .bind(id)
            .fetch_all(&self.pool)
            .await
            .map_err(backend)?
            .into_iter()
            .map(MembershipRow::into_domain)
            .collect()
    }
}

#[derive(sqlx::FromRow)]
struct MembershipRow {
    project_id: String,
    user_id: String,
    role: String,
}

impl MembershipRow {
    fn into_domain(self) -> RepoResult<Membership> {
        let role = Role::parse(&self.role)
            .ok_or_else(|| RepositoryError::Corrupted(format!("Invalid membership role: {}", self.role)))?;
        Ok(Membership { project_id: self.project_id.into(), user_id: self.user_id.into(), role })
    }
}

pub(crate) async fn put_membership(
    connection: &mut SqliteConnection,
    project_id: &ProjectId,
    user_id: &UserId,
    role: Role,
    now_ms: i64,
) -> RepoResult<()> {
    sqlx::query(
        "INSERT INTO memberships (project_id, user_id, role, created_at_ms, updated_at_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET
             role = excluded.role, updated_at_ms = excluded.updated_at_ms",
    )
    .bind(project_id.as_str())
    .bind(user_id.as_str())
    .bind(role.as_str())
    .bind(now_ms)
    .execute(connection)
    .await
    .map_err(backend)?;
    Ok(())
}

#[async_trait]
impl MembershipRepository for SqliteMembershipStore {
    async fn members(&self, project_id: &ProjectId) -> RepoResult<Vec<Membership>> {
        self.select("project_id", project_id.as_str()).await
    }

    async fn memberships_of(&self, user_id: &UserId) -> RepoResult<Vec<Membership>> {
        self.select("user_id", user_id.as_str()).await
    }

    async fn put(&self, membership: &Membership, now_ms: i64) -> RepoResult<()> {
        let mut connection = self.pool.acquire().await.map_err(backend)?;
        put_membership(&mut connection, &membership.project_id, &membership.user_id, membership.role, now_ms).await
    }

    async fn remove(&self, project_id: &ProjectId, user_id: &UserId) -> RepoResult<bool> {
        let result = sqlx::query("DELETE FROM memberships WHERE project_id = ? AND user_id = ?")
            .bind(project_id.as_str())
            .bind(user_id.as_str())
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(result.rows_affected() > 0)
    }
}
