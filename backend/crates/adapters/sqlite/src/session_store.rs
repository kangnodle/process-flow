use async_trait::async_trait;
use process_flow_application::ports::{RepoResult, Session, SessionRepository};
use process_flow_domain::UserId;
use process_flow_domain::user::User;
use sqlx::{FromRow, Row, SqlitePool};

use crate::schema::backend;
use crate::user_store::UserRow;

#[derive(Debug, Clone)]
pub struct SqliteSessionStore {
    pool: SqlitePool,
}

impl SqliteSessionStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct SessionRow {
    token_digest: String,
    user_id: String,
    expires_at_ms: i64,
}

impl From<SessionRow> for Session {
    fn from(row: SessionRow) -> Self {
        Session { token_digest: row.token_digest, user_id: row.user_id.into(), expires_at_ms: row.expires_at_ms }
    }
}

#[async_trait]
impl SessionRepository for SqliteSessionStore {
    async fn insert(&self, session: &Session, now_ms: i64) -> RepoResult<()> {
        sqlx::query("INSERT INTO sessions (token_digest, user_id, expires_at_ms, created_at_ms) VALUES (?, ?, ?, ?)")
            .bind(&session.token_digest)
            .bind(session.user_id.as_str())
            .bind(session.expires_at_ms)
            .bind(now_ms)
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn find(&self, token_digest: &str) -> RepoResult<Option<Session>> {
        let row = sqlx::query_as::<_, SessionRow>(
            "SELECT token_digest, user_id, expires_at_ms FROM sessions WHERE token_digest = ?",
        )
        .bind(token_digest)
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?;
        Ok(row.map(Into::into))
    }

    async fn find_with_user(&self, token_digest: &str) -> RepoResult<Option<(Session, Option<User>)>> {
        let result = sqlx::query(
            "SELECT s.token_digest, s.user_id, s.expires_at_ms, u.id, u.email, u.name, u.active, u.is_admin, u.version
             FROM sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.token_digest = ?",
        )
        .bind(token_digest)
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?;

        result
            .map(|row| {
                let session = SessionRow::from_row(&row).map_err(backend)?.into();
                let user = row
                    .try_get::<Option<&str>, _>("id")
                    .map_err(backend)?
                    .map(|_| UserRow::from_row(&row).map_err(backend)?.into_domain())
                    .transpose()?;
                Ok((session, user))
            })
            .transpose()
    }

    async fn extend(&self, token_digest: &str, expires_at_ms: i64) -> RepoResult<()> {
        sqlx::query("UPDATE sessions SET expires_at_ms = ? WHERE token_digest = ?")
            .bind(expires_at_ms)
            .bind(token_digest)
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn remove(&self, token_digest: &str) -> RepoResult<()> {
        sqlx::query("DELETE FROM sessions WHERE token_digest = ?")
            .bind(token_digest)
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn remove_for_user(&self, user_id: &UserId, keep: Option<&str>) -> RepoResult<()> {
        sqlx::query("DELETE FROM sessions WHERE user_id = ?1 AND (?2 IS NULL OR token_digest != ?2)")
            .bind(user_id.as_str())
            .bind(keep)
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }

    async fn remove_expired(&self, now_ms: i64) -> RepoResult<()> {
        sqlx::query("DELETE FROM sessions WHERE expires_at_ms <= ?")
            .bind(now_ms)
            .execute(&self.pool)
            .await
            .map_err(backend)?;
        Ok(())
    }
}
