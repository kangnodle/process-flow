use async_trait::async_trait;
use process_flow_application::RepositoryError;
use process_flow_application::ports::{PreferencesRepository, RepoResult};
use process_flow_application::preferences::{Locale, Theme, View, WorkspacePreferences};
use process_flow_domain::TaskId;
use process_flow_domain::WorkflowId;
use sqlx::SqlitePool;

use crate::schema::backend;

#[derive(Debug, Clone)]
pub struct SqlitePreferencesStore {
    pool: SqlitePool,
}

impl SqlitePreferencesStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct PreferencesRow {
    locale: Option<String>,
    theme: Option<String>,
    view: Option<String>,
    selected_task_id: Option<String>,
}

fn parse<T>(value: Option<String>, field: &str, parse: impl FnOnce(&str) -> Option<T>) -> RepoResult<Option<T>> {
    value
        .map(|text| parse(&text).ok_or_else(|| RepositoryError::Corrupted(format!("Invalid {field}: {text}"))))
        .transpose()
}

impl PreferencesRow {
    fn into_domain(self) -> RepoResult<WorkspacePreferences> {
        Ok(WorkspacePreferences {
            locale: parse(self.locale, "locale", Locale::parse)?,
            theme: parse(self.theme, "theme", Theme::parse)?,
            view: parse(self.view, "view", View::parse)?,
            selected_task_id: self.selected_task_id.map(Into::into),
        })
    }
}

#[async_trait]
impl PreferencesRepository for SqlitePreferencesStore {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<WorkspacePreferences> {
        sqlx::query_as::<_, PreferencesRow>(
            "SELECT locale, theme, view, selected_task_id FROM workflow_preferences WHERE workflow_id = ?",
        )
        .bind(workflow_id.as_str())
        .fetch_optional(&self.pool)
        .await
        .map_err(backend)?
        .map_or_else(|| Ok(WorkspacePreferences::default()), PreferencesRow::into_domain)
    }

    async fn merge(
        &self,
        workflow_id: &WorkflowId,
        patch: &WorkspacePreferences,
        updated_at_ms: i64,
    ) -> RepoResult<WorkspacePreferences> {
        sqlx::query_as::<_, PreferencesRow>(
            "INSERT INTO workflow_preferences (workflow_id, locale, theme, view, selected_task_id, updated_at_ms)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (workflow_id) DO UPDATE SET
                 locale = COALESCE(excluded.locale, workflow_preferences.locale),
                 theme = COALESCE(excluded.theme, workflow_preferences.theme),
                 view = COALESCE(excluded.view, workflow_preferences.view),
                 selected_task_id = COALESCE(excluded.selected_task_id, workflow_preferences.selected_task_id),
                 updated_at_ms = excluded.updated_at_ms
             RETURNING locale, theme, view, selected_task_id",
        )
        .bind(workflow_id.as_str())
        .bind(patch.locale.map(Locale::as_str))
        .bind(patch.theme.map(Theme::as_str))
        .bind(patch.view.map(View::as_str))
        .bind(patch.selected_task_id.as_ref().map(TaskId::as_str))
        .bind(updated_at_ms)
        .fetch_one(&self.pool)
        .await
        .map_err(backend)?
        .into_domain()
    }
}
