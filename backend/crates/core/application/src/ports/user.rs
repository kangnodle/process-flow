use super::RepoResult;
use async_trait::async_trait;
use process_flow_domain::UserId;
use process_flow_domain::user::User;

#[async_trait]
pub trait UserRepository: Send + Sync {
    async fn insert(&self, user: &User, created_at_ms: i64) -> RepoResult<()>;
    async fn find(&self, id: &UserId) -> RepoResult<Option<User>>;
    async fn find_by_email(&self, email: &str) -> RepoResult<Option<User>>;
    async fn find_many(&self, ids: &[UserId]) -> RepoResult<Vec<User>> {
        let mut found = Vec::new();
        for id in ids {
            found.extend(self.find(id).await?);
        }
        Ok(found)
    }
    async fn has_admin(&self) -> RepoResult<bool>;
    async fn save_first_admin(&self, user: &User, password_hash: &str, now_ms: i64) -> RepoResult<bool>;
    async fn list(&self, include_inactive: bool) -> RepoResult<Vec<User>>;
    async fn update(&self, user: &User, expected_version: u64, updated_at_ms: i64) -> RepoResult<()>;
}

#[async_trait]
pub trait CredentialRepository: Send + Sync {
    async fn find(&self, user_id: &UserId) -> RepoResult<Option<String>>;
    async fn put(&self, user_id: &UserId, password_hash: &str, now_ms: i64) -> RepoResult<()>;
}
