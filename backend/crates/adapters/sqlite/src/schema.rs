use std::str::FromStr;
use std::time::Duration;

use process_flow_application::RepositoryError;
use process_flow_application::ports::RepoResult;
use serde::Serialize;
use serde::de::DeserializeOwned;
use sqlx::SqlitePool;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteQueryResult};

#[derive(Debug, Clone)]
pub struct SqliteConfig {
    pub url: String,
}

impl SqliteConfig {
    pub fn is_in_memory(&self) -> bool {
        let location = self.url.trim_start_matches("sqlite://").trim_start_matches("sqlite:");
        let (filename, parameters) = location.split_once('?').unwrap_or((location, ""));
        filename == ":memory:"
            || url::form_urlencoded::parse(parameters.as_bytes()).any(|(key, value)| key == "mode" && value == "memory")
    }
}

pub async fn connect(config: &SqliteConfig) -> RepoResult<SqlitePool> {
    let options = SqliteConnectOptions::from_str(&config.url)
        .map_err(backend)?
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let memory = config.is_in_memory();
    if let Some(parent) = options.get_filename().parent().filter(|path| !memory && !path.as_os_str().is_empty()) {
        tokio::fs::create_dir_all(parent).await.map_err(backend)?;
    }
    let mut pool_options = SqlitePoolOptions::new().min_connections(1).max_connections(if memory { 1 } else { 8 });
    if memory {
        pool_options = pool_options.max_lifetime(None).idle_timeout(None).test_before_acquire(false);
    }
    let pool = pool_options.connect_with(options).await.map_err(backend)?;
    if let Err(error) = sqlx::migrate!().run(&pool).await {
        pool.close().await;
        return Err(backend(error));
    }
    Ok(pool)
}

pub(crate) fn backend(error: impl std::fmt::Display) -> RepositoryError {
    RepositoryError::Backend(error.to_string())
}

pub(crate) fn write_error(error: sqlx::Error, key: &str) -> RepositoryError {
    if error.as_database_error().is_some_and(sqlx::error::DatabaseError::is_unique_violation) {
        return RepositoryError::AlreadyExists(key.into());
    }
    backend(error)
}

pub(crate) fn require_version(result: SqliteQueryResult, expected: u64) -> RepoResult<()> {
    if result.rows_affected() == 1 { Ok(()) } else { Err(RepositoryError::VersionConflict { expected }) }
}

pub(crate) fn integer(value: impl TryInto<i64>, field: &str) -> RepoResult<i64> {
    value.try_into().map_err(|_| backend(format!("{field} exceeds the SQLite integer range")))
}

pub(crate) fn stored_integer<T: TryFrom<i64>>(value: i64, field: &str) -> RepoResult<T> {
    T::try_from(value).map_err(|_| RepositoryError::Corrupted(format!("Invalid {field}: {value}")))
}

pub(crate) fn encode(value: &impl Serialize) -> RepoResult<String> {
    serde_json::to_string(value).map_err(backend)
}

pub(crate) fn decode<T: DeserializeOwned>(text: &str) -> RepoResult<T> {
    serde_json::from_str(text).map_err(|error| RepositoryError::Corrupted(error.to_string()))
}
