use async_trait::async_trait;
use process_flow_domain::{TaskId, WorkflowId};

use crate::ports::RepoResult;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct SearchKey {
    pub workflow_id: WorkflowId,
    pub task_id: TaskId,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchDocument {
    pub key: SearchKey,
    pub revision: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchJob {
    pub id: u64,
    pub document: SearchDocument,
    pub attempts: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SearchCandidate {
    pub document: SearchDocument,
    pub score: f64,
}

#[async_trait]
pub trait SearchSource: Send + Sync {
    async fn current(&self, key: &SearchKey) -> RepoResult<Option<SearchDocument>>;
    async fn page(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>>;
    async fn enqueue(&self, document: &SearchDocument) -> RepoResult<bool>;
}

#[async_trait]
pub trait SearchJobs: Send + Sync {
    async fn pending(&self, now_ms: i64, limit: usize) -> RepoResult<Vec<SearchJob>>;
    async fn acknowledge(&self, job: &SearchJob) -> RepoResult<()>;
    async fn retry(&self, job: &SearchJob, available_at_ms: i64) -> RepoResult<()>;
}

#[async_trait]
pub trait VectorIndex: Send + Sync {
    async fn upsert(&self, document: &SearchDocument, embedding: &[f32]) -> RepoResult<()>;
    async fn remove(&self, key: &SearchKey) -> RepoResult<()>;
    async fn nearest(
        &self,
        query: &[f32],
        workflows: Option<&[WorkflowId]>,
        limit: usize,
    ) -> RepoResult<Vec<SearchCandidate>>;
    async fn documents(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>>;
}
