use super::RepoResult;
use async_trait::async_trait;
use process_flow_domain::UserId;
use process_flow_domain::user::User;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub token_digest: String,
    pub user_id: UserId,
    pub expires_at_ms: i64,
}

#[async_trait]
pub trait SessionRepository: Send + Sync {
    async fn insert(&self, session: &Session, now_ms: i64) -> RepoResult<()>;
    async fn find(&self, token_digest: &str) -> RepoResult<Option<Session>>;
    async fn find_with_user(&self, token_digest: &str) -> RepoResult<Option<(Session, Option<User>)>>;
    async fn extend(&self, token_digest: &str, expires_at_ms: i64) -> RepoResult<()>;
    async fn remove(&self, token_digest: &str) -> RepoResult<()>;
    async fn remove_for_user(&self, user_id: &UserId, keep: Option<&str>) -> RepoResult<()>;
    async fn remove_expired(&self, now_ms: i64) -> RepoResult<()>;
}

#[async_trait]
pub trait PasswordHasher: Send + Sync {
    async fn hash(&self, password: &str) -> Result<String, String>;
    async fn verify(&self, password: &str, hash: &str) -> Result<bool, String>;
}

pub trait TokenGenerator: Send + Sync {
    fn generate(&self) -> String;
    fn digest(&self, token: &str) -> String;
}
