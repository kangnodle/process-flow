use std::sync::Arc;

use process_flow_domain::UserId;
use process_flow_domain::user::{Actor, User, UserPatch, validate_password};

use process_flow_application::contexts::user::UserUpdateContext;
use process_flow_application::error::{AppResult, ApplicationError, RepositoryError, require_admin};
use process_flow_application::ports::{
    Clock, CredentialRepository, IdGenerator, PasswordHasher, SessionRepository, UserRepository,
};

#[derive(Clone)]
pub struct UserServiceDeps {
    pub users: Arc<dyn UserRepository>,
    pub credentials: Arc<dyn CredentialRepository>,
    pub sessions: Arc<dyn SessionRepository>,
    pub hasher: Arc<dyn PasswordHasher>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
}

impl std::fmt::Debug for UserServiceDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserServiceDeps").finish_non_exhaustive()
    }
}

#[derive(Clone)]
pub struct UserService {
    deps: UserServiceDeps,
}

impl std::fmt::Debug for UserService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UserService").finish_non_exhaustive()
    }
}

fn write_error(email: &str, error: RepositoryError) -> ApplicationError {
    match error {
        RepositoryError::AlreadyExists(_) => ApplicationError::Conflict(format!("이미 쓰는 이메일입니다: {email}")),
        RepositoryError::VersionConflict { expected } => ApplicationError::VersionConflict { expected },
        other => other.into(),
    }
}

impl UserService {
    pub fn new(deps: UserServiceDeps) -> Self {
        Self { deps }
    }

    pub async fn create(&self, actor: &Actor, email: &str, name: &str, password: &str) -> AppResult<User> {
        require_admin(actor)?;
        validate_password(password)?;
        let user = User::create(UserId::new(self.deps.ids.next_id()), email, name)?;
        let hash = self.deps.hasher.hash(password).await.map_err(ApplicationError::External)?;
        let now = self.deps.clock.now_ms();
        self.deps.users.insert(&user, now).await.map_err(|error| write_error(&user.email, error))?;
        self.deps.credentials.put(&user.id, &hash, now).await?;
        Ok(user)
    }

    pub async fn list(&self, include_inactive: bool) -> AppResult<Vec<User>> {
        Ok(self.deps.users.list(include_inactive).await?)
    }

    pub async fn get(&self, id: &UserId) -> AppResult<User> {
        self.deps
            .users
            .find(id)
            .await?
            .ok_or_else(|| ApplicationError::NotFound { entity: "사용자", id: id.to_string() })
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: &UserId,
        patch: &UserPatch,
        expected_version: Option<u64>,
    ) -> AppResult<User> {
        require_admin(actor)?;
        let user = self.get(id).await?;
        let Some(plan) = (UserUpdateContext { user: &user }).plan(patch, expected_version)? else {
            return Ok(user);
        };
        if plan.check_administrators {
            plan.validate_administrators(&self.deps.users.list(true).await?)?;
        }
        let updated = plan.user;
        self.deps
            .users
            .update(&updated, user.version, self.deps.clock.now_ms())
            .await
            .map_err(|error| write_error(&updated.email, error))?;
        if plan.end_sessions {
            self.deps.sessions.remove_for_user(id, None).await?;
        }
        Ok(updated)
    }

    pub async fn deactivate(&self, actor: &Actor, id: &UserId) -> AppResult<User> {
        self.update(actor, id, &UserPatch { active: Some(false), ..Default::default() }, None).await
    }

    pub async fn set_password(&self, actor: &Actor, id: &UserId, password: &str) -> AppResult<()> {
        require_admin(actor)?;
        validate_password(password)?;
        self.get(id).await?;
        let hash = self.deps.hasher.hash(password).await.map_err(ApplicationError::External)?;
        self.deps.credentials.put(id, &hash, self.deps.clock.now_ms()).await?;
        self.deps.sessions.remove_for_user(id, None).await?;
        Ok(())
    }
}
