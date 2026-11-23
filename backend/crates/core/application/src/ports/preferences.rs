use super::RepoResult;
use crate::preferences::WorkspacePreferences;
use async_trait::async_trait;
use process_flow_domain::WorkflowId;

#[async_trait]
pub trait PreferencesRepository: Send + Sync {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<WorkspacePreferences>;
    async fn merge(
        &self,
        workflow_id: &WorkflowId,
        patch: &WorkspacePreferences,
        updated_at_ms: i64,
    ) -> RepoResult<WorkspacePreferences>;
}
