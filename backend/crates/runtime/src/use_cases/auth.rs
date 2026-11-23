use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use process_flow_domain::UserId;
use process_flow_domain::user::{Actor, PASSWORD_MAX_CHARS, User, UserPatch, normalize_email, validate_password};

use process_flow_application::contexts::auth::{
    FailureWindow, SessionDecision, ThrottleSettings, failure_is_recent, next_failure, session_decision, throttled,
};
use process_flow_application::error::{AppResult, ApplicationError, RepositoryError};
use process_flow_application::ports::{
    Clock, CredentialRepository, IdGenerator, PasswordHasher, Session, SessionRepository, TokenGenerator,
    UserRepository,
};

const DUMMY_PASSWORD: &str = "process-flow-dummy-password";
const MAX_TRACKED_EMAILS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthSettings {
    pub session_ttl_ms: i64,
    pub max_failures: u32,
    pub failure_window_ms: i64,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self { session_ttl_ms: 7 * 24 * 60 * 60 * 1000, max_failures: 10, failure_window_ms: 15 * 60 * 1000 }
    }
}

#[derive(Clone)]
pub struct AuthServiceDeps {
    pub users: Arc<dyn UserRepository>,
    pub credentials: Arc<dyn CredentialRepository>,
    pub sessions: Arc<dyn SessionRepository>,
    pub hasher: Arc<dyn PasswordHasher>,
    pub tokens: Arc<dyn TokenGenerator>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
}

impl std::fmt::Debug for AuthServiceDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthServiceDeps").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionGrant {
    pub token: String,
    pub expires_at_ms: i64,
    pub user: User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authenticated {
    pub user: User,
    pub renewed_until_ms: Option<i64>,
}

impl Authenticated {
    pub fn actor(&self) -> Actor {
        self.user.actor()
    }
}

#[derive(Clone)]
pub struct AuthService {
    deps: AuthServiceDeps,
    settings: AuthSettings,
    failures: Arc<Mutex<HashMap<String, FailureWindow>>>,
    dummy_hash: Arc<Mutex<Option<String>>>,
}

impl std::fmt::Debug for AuthService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthService").field("settings", &self.settings).finish_non_exhaustive()
    }
}

impl AuthService {
    pub fn new(deps: AuthServiceDeps, settings: AuthSettings) -> Self {
        Self { deps, settings, failures: Arc::default(), dummy_hash: Arc::default() }
    }

    pub fn session_ttl_ms(&self) -> i64 {
        self.settings.session_ttl_ms
    }

    pub async fn setup_required(&self) -> AppResult<bool> {
        Ok(!self.deps.users.has_admin().await?)
    }

    pub async fn setup(&self, email: &str, name: &str, password: &str) -> AppResult<SessionGrant> {
        let already = || ApplicationError::Conflict("초기 설정은 이미 끝났습니다".into());
        if !self.setup_required().await? {
            return Err(already());
        }
        validate_password(password)?;
        let email = normalize_email(email)?;
        let user = match self.deps.users.find_by_email(&email).await? {
            Some(existing) => {
                let patch = UserPatch {
                    name: Some(name.to_owned()),
                    active: Some(true),
                    is_admin: Some(true),
                    ..Default::default()
                };
                existing.apply(&patch)?.unwrap_or(existing)
            }
            None => {
                let created = User::create(UserId::new(self.deps.ids.next_id()), &email, name)?;
                User { is_admin: true, ..created }
            }
        };
        let hash = self.deps.hasher.hash(password).await.map_err(ApplicationError::External)?;
        let now = self.deps.clock.now_ms();
        match self.deps.users.save_first_admin(&user, &hash, now).await {
            Ok(true) => self.grant(user).await,
            Ok(false) => Err(already()),
            Err(RepositoryError::AlreadyExists(_)) => {
                Err(ApplicationError::Conflict(format!("이미 쓰는 이메일입니다: {email}")))
            }
            Err(other) => Err(other.into()),
        }
    }

    pub async fn login(&self, email: &str, password: &str) -> AppResult<SessionGrant> {
        let Ok(email) = normalize_email(email) else { return Err(ApplicationError::InvalidCredentials) };
        self.ensure_not_throttled(&email)?;
        if password.chars().count() > PASSWORD_MAX_CHARS {
            self.record_failure(&email)?;
            return Err(ApplicationError::InvalidCredentials);
        }

        let user = self.deps.users.find_by_email(&email).await?.filter(|user| user.active);
        let stored = match &user {
            Some(user) => self.deps.credentials.find(&user.id).await?,
            None => None,
        };
        let verified = match &stored {
            Some(hash) => self.deps.hasher.verify(password, hash).await,
            None => {
                let dummy = self.dummy_hash().await?;
                self.deps.hasher.verify(password, &dummy).await.map(|_| false)
            }
        }
        .map_err(ApplicationError::External)?;

        match user {
            Some(user) if verified => {
                match self.failures.lock() {
                    Ok(guard) => guard,
                    Err(_) => return Err(ApplicationError::External("로그인 실패 기록 잠금이 손상되었습니다".into())),
                }
                .remove(&email);
                self.grant(user).await
            }
            _ => {
                self.record_failure(&email)?;
                Err(ApplicationError::InvalidCredentials)
            }
        }
    }

    pub async fn authenticate(&self, token: &str) -> AppResult<Authenticated> {
        let digest = self.deps.tokens.digest(token);
        let (session, user) =
            self.deps.sessions.find_with_user(&digest).await?.ok_or(ApplicationError::Unauthenticated)?;
        let now = self.deps.clock.now_ms();
        let decision = session_decision(session.expires_at_ms, now, self.settings.session_ttl_ms);
        if decision == SessionDecision::Expired {
            self.deps.sessions.remove(&digest).await?;
            return Err(ApplicationError::Unauthenticated);
        }
        let user = user.filter(|user| user.active).ok_or(ApplicationError::Unauthenticated)?;
        let renewed_until_ms = match decision {
            SessionDecision::RenewUntil(renewed) => {
                self.deps.sessions.extend(&digest, renewed).await?;
                Some(renewed)
            }
            SessionDecision::Expired | SessionDecision::Keep => None,
        };
        Ok(Authenticated { user, renewed_until_ms })
    }

    pub async fn logout(&self, token: &str) -> AppResult<()> {
        Ok(self.deps.sessions.remove(&self.deps.tokens.digest(token)).await?)
    }

    pub async fn change_password(&self, actor: &Actor, token: &str, current: &str, new: &str) -> AppResult<()> {
        validate_password(new)?;
        let stored = self.deps.credentials.find(&actor.user_id).await?;
        let matches = match stored {
            Some(hash) if current.chars().count() <= PASSWORD_MAX_CHARS => {
                self.deps.hasher.verify(current, &hash).await.map_err(ApplicationError::External)?
            }
            _ => false,
        };
        if !matches {
            return Err(ApplicationError::Invalid("지금 비밀번호가 올바르지 않습니다".into()));
        }
        let hash = self.deps.hasher.hash(new).await.map_err(ApplicationError::External)?;
        self.deps.credentials.put(&actor.user_id, &hash, self.deps.clock.now_ms()).await?;
        self.deps.sessions.remove_for_user(&actor.user_id, Some(&self.deps.tokens.digest(token))).await?;
        Ok(())
    }

    async fn grant(&self, user: User) -> AppResult<SessionGrant> {
        let now = self.deps.clock.now_ms();
        self.deps.sessions.remove_expired(now).await?;
        let token = self.deps.tokens.generate();
        let expires_at_ms = now + self.settings.session_ttl_ms;
        let session =
            Session { token_digest: self.deps.tokens.digest(&token), user_id: user.id.clone(), expires_at_ms };
        self.deps.sessions.insert(&session, now).await?;
        Ok(SessionGrant { token, expires_at_ms, user })
    }

    async fn dummy_hash(&self) -> AppResult<String> {
        if let Some(hash) = match self.dummy_hash.lock() {
            Ok(guard) => guard,
            Err(_) => return Err(ApplicationError::External("더미 비밀번호 해시 잠금이 손상되었습니다".into())),
        }
        .clone()
        {
            return Ok(hash);
        }
        let hash = self.deps.hasher.hash(DUMMY_PASSWORD).await.map_err(ApplicationError::External)?;
        *match self.dummy_hash.lock() {
            Ok(guard) => guard,
            Err(_) => return Err(ApplicationError::External("더미 비밀번호 해시 잠금이 손상되었습니다".into())),
        } = Some(hash.clone());
        Ok(hash)
    }

    fn ensure_not_throttled(&self, email: &str) -> AppResult<()> {
        let now = self.deps.clock.now_ms();
        let failures = match self.failures.lock() {
            Ok(guard) => guard,
            Err(_) => return Err(ApplicationError::External("로그인 실패 기록 잠금이 손상되었습니다".into())),
        };
        if throttled(failures.get(email).copied(), self.throttle_settings(), now) {
            Err(ApplicationError::TooManyAttempts)
        } else {
            Ok(())
        }
    }

    fn throttle_settings(&self) -> ThrottleSettings {
        ThrottleSettings {
            max_failures: self.settings.max_failures,
            failure_window_ms: self.settings.failure_window_ms,
        }
    }

    fn record_failure(&self, email: &str) -> AppResult<()> {
        let now = self.deps.clock.now_ms();
        let settings = self.throttle_settings();
        let mut failures = match self.failures.lock() {
            Ok(guard) => guard,
            Err(_) => return Err(ApplicationError::External("로그인 실패 기록 잠금이 손상되었습니다".into())),
        };
        if failures.len() >= MAX_TRACKED_EMAILS {
            failures.retain(|_, entry| failure_is_recent(*entry, settings, now));
        }
        let next = next_failure(failures.get(email).copied(), settings, now);
        failures.insert(email.to_owned(), next);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use process_flow_testing::{FixedClock, InMemoryStore, PlainHasher, SequentialIds, SequentialTokens};

    fn auth_service() -> AuthService {
        let store = Arc::new(InMemoryStore::default());
        AuthService::new(
            AuthServiceDeps {
                users: store.clone(),
                credentials: store.clone(),
                sessions: store,
                hasher: Arc::new(PlainHasher),
                tokens: Arc::new(SequentialTokens::default()),
                clock: Arc::new(FixedClock::default()),
                ids: Arc::new(SequentialIds::default()),
            },
            AuthSettings::default(),
        )
    }

    fn poison<T>(lock: &Mutex<T>) {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = match lock.lock() {
                Ok(guard) => guard,
                Err(error) => panic!("test lock was already poisoned: {error}"),
            };
            panic!("poison authentication state for regression test");
        }));
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn poisoned_failures_reject_login_without_panicking() {
        let auth = auth_service();
        poison(&auth.failures);
        assert!(matches!(auth.login("user@example.com", "password1").await, Err(ApplicationError::External(_))));
    }

    #[tokio::test]
    async fn poisoned_dummy_hash_returns_an_error_without_panicking() {
        let auth = auth_service();
        poison(&auth.dummy_hash);
        assert!(matches!(auth.dummy_hash().await, Err(ApplicationError::External(_))));
    }
}
