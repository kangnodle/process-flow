use super::RepoResult;
use async_trait::async_trait;
use process_flow_domain::assignment::{Assignments, Authority};
use process_flow_domain::workflow::{Event, Workflow};
use process_flow_domain::{ProjectId, UserId, WorkflowId};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub struct RecordedEvent {
    pub workflow_id: WorkflowId,
    pub version: u64,
    pub occurred_at_ms: i64,
    pub actor: UserId,
    pub authority: Authority,
    pub event: Event,
}

#[async_trait]
pub trait WorkflowRepository: Send + Sync {
    async fn insert(&self, workflow: &Workflow, created_at_ms: i64) -> RepoResult<()>;
    async fn find(&self, id: &WorkflowId) -> RepoResult<Option<Workflow>>;
    async fn list(&self, project_id: Option<&ProjectId>) -> RepoResult<Vec<Workflow>>;
    async fn list_in(&self, project_ids: &[ProjectId]) -> RepoResult<Vec<Workflow>> {
        let all = self.list(None).await?;
        Ok(all.into_iter().filter(|workflow| project_ids.contains(&workflow.project_id)).collect())
    }
    async fn update(&self, workflow: &Workflow, expected_version: u64, events: &[RecordedEvent]) -> RepoResult<()>;
}

#[async_trait]
pub trait AssignmentRepository: Send + Sync {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<Assignments>;
    async fn find_many(&self, workflow_ids: &[WorkflowId]) -> RepoResult<BTreeMap<WorkflowId, Assignments>> {
        let mut found = BTreeMap::new();
        for id in workflow_ids {
            found.insert(id.clone(), self.find(id).await?);
        }
        Ok(found)
    }
    async fn save(
        &self,
        workflow_id: &WorkflowId,
        assignments: &Assignments,
        expected_version: u64,
        changed_by: &UserId,
        now_ms: i64,
    ) -> RepoResult<()>;
}
