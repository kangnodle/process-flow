use async_trait::async_trait;
use process_flow_application::ports::{CredentialRepository, RepoResult, UserRepository};
use process_flow_domain::UserId;
use process_flow_domain::user::User;
use sqlx::{SqliteConnection, SqlitePool};

use crate::schema::{backend, encode, integer, require_version, stored_integer, write_error};

#[derive(Debug, Clone)]
pub struct SqliteUserStore {
    pool: SqlitePool,
}

impl SqliteUserStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
pub(crate) struct UserRow {
    id: String,
    email: String,
    name: String,
    active: bool,
    is_admin: bool,
    version: i64,
}

impl UserRow {
    pub(crate) fn into_domain(self) -> RepoResult<User> {
        Ok(User {
            id: self.id.into(),
            email: self.email,
            name: self.name,
            active: self.active,
            is_admin: self.is_admin,
            version: stored_integer(self.version, "user version")?,
        })
    }
}

async fn has_active_admin(connection: &mut SqliteConnection) -> RepoResult<bool> {
    sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE active = 1 AND is_admin = 1)")
        .fetch_one(connection)
        .await
        .map_err(backend)
}

async fn put_credential(
    connection: &mut SqliteConnection,
    user_id: &UserId,
    password_hash: &str,
    now_ms: i64,
) -> RepoResult<()> {
    sqlx::query(
        "INSERT INTO credentials (user_id, password_hash, updated_at_ms) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
             password_hash = excluded.password_hash, updated_at_ms = excluded.updated_at_ms",
    )
    .bind(user_id.as_str())
    .bind(password_hash)
    .bind(now_ms)
    .execute(connection)
    .await
    .map_err(backend)?;
    Ok(())
}

#[async_trait]
impl UserRepository for SqliteUserStore {
    async fn insert(&self, user: &User, created_at_ms: i64) -> RepoResult<()> {
        sqlx::query(
            "INSERT INTO users (id, email, name, active, is_admin, version, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        )
        .bind(user.id.as_str())
        .bind(&user.email)
        .bind(&user.name)
        .bind(user.active)
        .bind(user.is_admin)
        .bind(integer(user.version, "user version")?)
        .bind(created_at_ms)
        .execute(&self.pool)
        .await
        .map_err(|error| write_error(error, &user.email))?;
        Ok(())
    }

    async fn find(&self, id: &UserId) -> RepoResult<Option<User>> {
        sqlx::query_as::<_, UserRow>("SELECT id, email, name, active, is_admin, version FROM users WHERE id = ?")
            .bind(id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(backend)?
            .map(UserRow::into_domain)
            .transpose()
    }

    async fn find_by_email(&self, email: &str) -> RepoResult<Option<User>> {
        sqlx::query_as::<_, UserRow>("SELECT id, email, name, active, is_admin, version FROM users WHERE email = ?")
            .bind(email)
            .fetch_optional(&self.pool)
            .await
            .map_err(backend)?
            .map(UserRow::into_domain)
            .transpose()
    }

    async fn find_many(&self, ids: &[UserId]) -> RepoResult<Vec<User>> {
        let keys = encode(&ids.iter().map(UserId::as_str).collect::<Vec<_>>())?;
        sqlx::query_as::<_, UserRow>(
            "SELECT u.id, u.email, u.name, u.active, u.is_admin, u.version
             FROM json_each(?) requested JOIN users u ON u.id = requested.value ORDER BY requested.key",
        )
        .bind(keys)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(UserRow::into_domain)
        .collect()
    }

    async fn has_admin(&self) -> RepoResult<bool> {
        let mut connection = self.pool.acquire().await.map_err(backend)?;
        has_active_admin(&mut connection).await
    }

    async fn save_first_admin(&self, user: &User, password_hash: &str, now_ms: i64) -> RepoResult<bool> {
        let mut transaction = self.pool.begin_with("BEGIN IMMEDIATE").await.map_err(backend)?;
        if has_active_admin(&mut transaction).await? {
            transaction.rollback().await.map_err(backend)?;
            return Ok(false);
        }
        sqlx::query(
            "INSERT INTO users (id, email, name, active, is_admin, version, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT (id) DO UPDATE SET
                 email = excluded.email, name = excluded.name, active = excluded.active,
                 is_admin = excluded.is_admin, version = excluded.version, updated_at_ms = excluded.updated_at_ms",
        )
        .bind(user.id.as_str())
        .bind(&user.email)
        .bind(&user.name)
        .bind(user.active)
        .bind(user.is_admin)
        .bind(integer(user.version, "user version")?)
        .bind(now_ms)
        .execute(&mut *transaction)
        .await
        .map_err(|error| write_error(error, &user.email))?;
        put_credential(&mut transaction, &user.id, password_hash, now_ms).await?;
        sqlx::query(
            "INSERT INTO auth_setup (singleton, user_id, created_at_ms) VALUES (1, ?, ?)
             ON CONFLICT (singleton) DO UPDATE SET
                 user_id = excluded.user_id, created_at_ms = excluded.created_at_ms",
        )
        .bind(user.id.as_str())
        .bind(now_ms)
        .execute(&mut *transaction)
        .await
        .map_err(backend)?;
        transaction.commit().await.map_err(backend)?;
        Ok(true)
    }

    async fn list(&self, include_inactive: bool) -> RepoResult<Vec<User>> {
        sqlx::query_as::<_, UserRow>(
            "SELECT id, email, name, active, is_admin, version FROM users WHERE ? OR active = 1
             ORDER BY created_at_ms, id",
        )
        .bind(include_inactive)
        .fetch_all(&self.pool)
        .await
        .map_err(backend)?
        .into_iter()
        .map(UserRow::into_domain)
        .collect()
    }

    async fn update(&self, user: &User, expected_version: u64, updated_at_ms: i64) -> RepoResult<()> {
        let result = sqlx::query(
            "UPDATE users SET email = ?, name = ?, active = ?, is_admin = ?, version = ?, updated_at_ms = ?
             WHERE id = ? AND version = ?",
        )
        .bind(&user.email)
        .bind(&user.name)
        .bind(user.active)
        .bind(user.is_admin)
        .bind(integer(user.version, "user version")?)
        .bind(updated_at_ms)
        .bind(user.id.as_str())
        .bind(i64::try_from(expected_version).unwrap_or(-1))
        .execute(&self.pool)
        .await
        .map_err(|error| write_error(error, &user.email))?;
        require_version(result, expected_version)
    }
}

#[async_trait]
impl CredentialRepository for SqliteUserStore {
    async fn find(&self, user_id: &UserId) -> RepoResult<Option<String>> {
        sqlx::query_scalar("SELECT password_hash FROM credentials WHERE user_id = ?")
            .bind(user_id.as_str())
            .fetch_optional(&self.pool)
            .await
            .map_err(backend)
    }

    async fn put(&self, user_id: &UserId, password_hash: &str, now_ms: i64) -> RepoResult<()> {
        let mut connection = self.pool.acquire().await.map_err(backend)?;
        put_credential(&mut connection, user_id, password_hash, now_ms).await
    }
}
