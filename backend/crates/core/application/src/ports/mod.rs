use crate::error::RepositoryError;

pub type RepoResult<T> = Result<T, RepositoryError>;

pub mod auth;
pub mod preferences;
pub mod process;
pub mod project;
pub mod services;
pub mod user;
pub mod workflow;

pub use auth::{PasswordHasher, Session, SessionRepository, TokenGenerator};
pub use preferences::PreferencesRepository;
pub use process::{ProcessGraph, ProcessRepository};
pub use project::{MembershipRepository, ProjectRepository};
pub use services::{Clock, Embedder, IdGenerator};
pub use user::{CredentialRepository, UserRepository};
pub use workflow::{AssignmentRepository, RecordedEvent, WorkflowRepository};
