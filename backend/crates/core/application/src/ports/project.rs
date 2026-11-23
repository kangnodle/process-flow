use super::RepoResult;
use async_trait::async_trait;
use process_flow_domain::membership::Membership;
use process_flow_domain::project::Project;
use process_flow_domain::{ProjectId, UserId};

#[async_trait]
pub trait ProjectRepository: Send + Sync {
    async fn insert(&self, project: &Project, owner: Option<&UserId>, created_at_ms: i64) -> RepoResult<()>;
    async fn find(&self, id: &ProjectId) -> RepoResult<Option<Project>>;
    async fn find_many(&self, ids: &[ProjectId]) -> RepoResult<Vec<Project>> {
        let mut found = Vec::new();
        for id in ids {
            found.extend(self.find(id).await?);
        }
        Ok(found)
    }
    async fn list(&self, include_archived: bool) -> RepoResult<Vec<Project>>;
    async fn delete_archived(&self, id: &ProjectId, expected_version: u64) -> RepoResult<()>;
    async fn update(&self, project: &Project, expected_version: u64, updated_at_ms: i64) -> RepoResult<()>;
}

#[async_trait]
pub trait MembershipRepository: Send + Sync {
    async fn members(&self, project_id: &ProjectId) -> RepoResult<Vec<Membership>>;
    async fn memberships_of(&self, user_id: &UserId) -> RepoResult<Vec<Membership>>;
    async fn put(&self, membership: &Membership, now_ms: i64) -> RepoResult<()>;
    async fn remove(&self, project_id: &ProjectId, user_id: &UserId) -> RepoResult<bool>;
}
