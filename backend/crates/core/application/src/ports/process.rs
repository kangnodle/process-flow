use super::RepoResult;
use async_trait::async_trait;
use process_flow_domain::process::Process;
use process_flow_domain::{ProcessId, TaskId};

#[async_trait]
pub trait ProcessRepository: Send + Sync {
    async fn find(&self, id: &ProcessId) -> RepoResult<Option<Process>>;
    async fn save(&self, process: &Process) -> RepoResult<()>;
}

#[async_trait]
pub trait ProcessGraph: Send + Sync {
    async fn prerequisites(&self, process_id: &ProcessId, task_id: &TaskId) -> RepoResult<Vec<TaskId>>;
}
