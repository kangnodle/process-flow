use std::collections::BTreeMap;
use std::sync::Mutex;

use async_trait::async_trait;
use process_flow_application::error::RepositoryError;
use process_flow_application::ports::{
    AssignmentRepository, CredentialRepository, MembershipRepository, PreferencesRepository, ProcessGraph,
    ProcessRepository, ProjectRepository, RecordedEvent, RepoResult, Session, SessionRepository, UserRepository,
    WorkflowRepository,
};
use process_flow_application::preferences::WorkspacePreferences;
use process_flow_domain::assignment::Assignments;
use process_flow_domain::membership::{Membership, Role};
use process_flow_domain::process::Process;
use process_flow_domain::project::Project;
use process_flow_domain::user::User;
use process_flow_domain::workflow::Workflow;
use process_flow_domain::{ProcessId, ProjectId, TaskId, UserId, WorkflowId};

#[derive(Debug, Default)]
pub struct InMemoryStore {
    pub(crate) projection: Mutex<crate::search::MemoryProjection>,
    processes: Mutex<BTreeMap<ProcessId, Process>>,
    projects: Mutex<Vec<Project>>,
    users: Mutex<Vec<User>>,
    credentials: Mutex<BTreeMap<UserId, String>>,
    pub sessions: Mutex<Vec<Session>>,
    memberships: Mutex<Vec<Membership>>,
    workflows: Mutex<Vec<Workflow>>,
    pub events: Mutex<Vec<RecordedEvent>>,
    assignments: Mutex<BTreeMap<WorkflowId, Assignments>>,
    pub assignment_changes: Mutex<Vec<(WorkflowId, u64, UserId)>>,
    preferences: Mutex<BTreeMap<WorkflowId, WorkspacePreferences>>,
}

#[async_trait]
impl PreferencesRepository for InMemoryStore {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<WorkspacePreferences> {
        Ok(match self.preferences.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .get(workflow_id)
        .cloned()
        .unwrap_or_default())
    }

    async fn merge(
        &self,
        workflow_id: &WorkflowId,
        patch: &WorkspacePreferences,
        _updated_at_ms: i64,
    ) -> RepoResult<WorkspacePreferences> {
        let mut all = match self.preferences.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        let entry = all.entry(workflow_id.clone()).or_default();
        *entry = std::mem::take(entry).merged(patch);
        Ok(entry.clone())
    }
}

#[async_trait]
impl ProcessRepository for InMemoryStore {
    async fn find(&self, id: &ProcessId) -> RepoResult<Option<Process>> {
        Ok(match self.processes.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .get(id)
        .cloned())
    }

    async fn save(&self, process: &Process) -> RepoResult<()> {
        match self.processes.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .insert(process.id().clone(), process.clone());
        Ok(())
    }
}

#[async_trait]
impl ProcessGraph for InMemoryStore {
    async fn prerequisites(&self, process_id: &ProcessId, task_id: &TaskId) -> RepoResult<Vec<TaskId>> {
        let processes = match self.processes.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        let Some(process) = processes.get(process_id) else { return Ok(Vec::new()) };
        let Ok(task) = process.task(task_id) else { return Ok(Vec::new()) };
        Ok(process.tasks().filter(|t| t.stage_index < task.stage_index).map(|t| t.id.clone()).collect())
    }
}

#[async_trait]
impl ProjectRepository for InMemoryStore {
    async fn insert(&self, project: &Project, owner: Option<&UserId>, _created_at_ms: i64) -> RepoResult<()> {
        let mut projects = match self.projects.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if projects.iter().any(|p| p.id == project.id) {
            return Err(RepositoryError::AlreadyExists(project.id.to_string()));
        }
        projects.push(project.clone());
        if let Some(owner) = owner {
            match self.memberships.lock() {
                Ok(value) => value,
                Err(error) => panic!("expected lock to succeed: {error:?}"),
            }
            .push(Membership { project_id: project.id.clone(), user_id: owner.clone(), role: Role::Owner });
        }
        Ok(())
    }

    async fn find(&self, id: &ProjectId) -> RepoResult<Option<Project>> {
        Ok(match self.projects.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|p| &p.id == id)
        .cloned())
    }

    async fn list(&self, include_archived: bool) -> RepoResult<Vec<Project>> {
        let projects = match self.projects.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        Ok(projects.iter().filter(|p| include_archived || !p.archived).cloned().collect())
    }

    async fn delete_archived(&self, id: &ProjectId, expected_version: u64) -> RepoResult<()> {
        let mut projects = match self.projects.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if !projects.iter().any(|p| &p.id == id && p.archived && p.version == expected_version) {
            return Err(RepositoryError::VersionConflict { expected: expected_version });
        }
        let mut workflows = match self.workflows.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        let ids: Vec<_> = workflows.iter().filter(|w| &w.project_id == id).map(|w| w.id.clone()).collect();
        self.projection.lock().expect("memory projection lock").delete_workflows(&ids);
        workflows.retain(|w| !ids.contains(&w.id));
        match self.memberships.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|m| &m.project_id != id);
        match self.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|e| !ids.contains(&e.workflow_id));
        match self.assignments.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|id, _| !ids.contains(id));
        match self.assignment_changes.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|(id, _, _)| !ids.contains(id));
        match self.preferences.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|id, _| !ids.contains(id));
        projects.retain(|p| &p.id != id);
        Ok(())
    }

    async fn update(&self, project: &Project, expected_version: u64, _updated_at_ms: i64) -> RepoResult<()> {
        let mut projects = match self.projects.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        match projects.iter_mut().find(|p| p.id == project.id) {
            Some(stored) if stored.version == expected_version => {
                *stored = project.clone();
                Ok(())
            }
            _ => Err(RepositoryError::VersionConflict { expected: expected_version }),
        }
    }
}

#[async_trait]
impl UserRepository for InMemoryStore {
    async fn insert(&self, user: &User, _created_at_ms: i64) -> RepoResult<()> {
        let mut users = match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if users.iter().any(|u| u.id == user.id || u.email == user.email) {
            return Err(RepositoryError::AlreadyExists(user.email.clone()));
        }
        users.push(user.clone());
        Ok(())
    }

    async fn find(&self, id: &UserId) -> RepoResult<Option<User>> {
        Ok(match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|u| &u.id == id)
        .cloned())
    }

    async fn find_by_email(&self, email: &str) -> RepoResult<Option<User>> {
        Ok(match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|u| u.email == email)
        .cloned())
    }

    async fn has_admin(&self) -> RepoResult<bool> {
        Ok(match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .any(|u| u.active && u.is_admin))
    }

    async fn save_first_admin(&self, user: &User, password_hash: &str, _now_ms: i64) -> RepoResult<bool> {
        let mut users = match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if users.iter().any(|u| u.active && u.is_admin) {
            return Ok(false);
        }
        if users.iter().any(|u| u.id != user.id && u.email == user.email) {
            return Err(RepositoryError::AlreadyExists(user.email.clone()));
        }
        match users.iter_mut().find(|u| u.id == user.id) {
            Some(stored) => *stored = user.clone(),
            None => users.push(user.clone()),
        }
        match self.credentials.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .insert(user.id.clone(), password_hash.to_owned());
        Ok(true)
    }

    async fn list(&self, include_inactive: bool) -> RepoResult<Vec<User>> {
        Ok(match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .filter(|u| include_inactive || u.active)
        .cloned()
        .collect())
    }

    async fn update(&self, user: &User, expected_version: u64, _updated_at_ms: i64) -> RepoResult<()> {
        let mut users = match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if users.iter().any(|u| u.id != user.id && u.email == user.email) {
            return Err(RepositoryError::AlreadyExists(user.email.clone()));
        }
        match users.iter_mut().find(|u| u.id == user.id) {
            Some(stored) if stored.version == expected_version => {
                *stored = user.clone();
                Ok(())
            }
            _ => Err(RepositoryError::VersionConflict { expected: expected_version }),
        }
    }
}

#[async_trait]
impl CredentialRepository for InMemoryStore {
    async fn find(&self, user_id: &UserId) -> RepoResult<Option<String>> {
        Ok(match self.credentials.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .get(user_id)
        .cloned())
    }

    async fn put(&self, user_id: &UserId, password_hash: &str, _now_ms: i64) -> RepoResult<()> {
        match self.credentials.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .insert(user_id.clone(), password_hash.to_owned());
        Ok(())
    }
}

#[async_trait]
impl SessionRepository for InMemoryStore {
    async fn insert(&self, session: &Session, _now_ms: i64) -> RepoResult<()> {
        match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .push(session.clone());
        Ok(())
    }

    async fn find(&self, token_digest: &str) -> RepoResult<Option<Session>> {
        Ok(match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|s| s.token_digest == token_digest)
        .cloned())
    }

    async fn find_with_user(&self, token_digest: &str) -> RepoResult<Option<(Session, Option<User>)>> {
        let Some(session) = SessionRepository::find(self, token_digest).await? else { return Ok(None) };
        let user = match self.users.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|u| u.id == session.user_id)
        .cloned();
        Ok(Some((session, user)))
    }

    async fn extend(&self, token_digest: &str, expires_at_ms: i64) -> RepoResult<()> {
        if let Some(session) = match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter_mut()
        .find(|s| s.token_digest == token_digest)
        {
            session.expires_at_ms = expires_at_ms;
        }
        Ok(())
    }

    async fn remove(&self, token_digest: &str) -> RepoResult<()> {
        match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|s| s.token_digest != token_digest);
        Ok(())
    }

    async fn remove_for_user(&self, user_id: &UserId, keep: Option<&str>) -> RepoResult<()> {
        match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|s| &s.user_id != user_id || keep == Some(s.token_digest.as_str()));
        Ok(())
    }

    async fn remove_expired(&self, now_ms: i64) -> RepoResult<()> {
        match self.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .retain(|s| s.expires_at_ms > now_ms);
        Ok(())
    }
}

#[async_trait]
impl MembershipRepository for InMemoryStore {
    async fn members(&self, project_id: &ProjectId) -> RepoResult<Vec<Membership>> {
        let memberships = match self.memberships.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        Ok(memberships.iter().filter(|m| &m.project_id == project_id).cloned().collect())
    }

    async fn memberships_of(&self, user_id: &UserId) -> RepoResult<Vec<Membership>> {
        let memberships = match self.memberships.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        Ok(memberships.iter().filter(|m| &m.user_id == user_id).cloned().collect())
    }

    async fn put(&self, membership: &Membership, _now_ms: i64) -> RepoResult<()> {
        let mut memberships = match self.memberships.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        match memberships.iter_mut().find(|m| m.project_id == membership.project_id && m.user_id == membership.user_id)
        {
            Some(stored) => stored.role = membership.role,
            None => memberships.push(membership.clone()),
        }
        Ok(())
    }

    async fn remove(&self, project_id: &ProjectId, user_id: &UserId) -> RepoResult<bool> {
        let mut memberships = match self.memberships.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        let before = memberships.len();
        memberships.retain(|m| !(&m.project_id == project_id && &m.user_id == user_id));
        Ok(memberships.len() != before)
    }
}

#[async_trait]
impl WorkflowRepository for InMemoryStore {
    async fn insert(&self, workflow: &Workflow, _created_at_ms: i64) -> RepoResult<()> {
        let mut workflows = match self.workflows.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if workflows.iter().any(|w| w.id == workflow.id) {
            return Err(RepositoryError::AlreadyExists(workflow.id.to_string()));
        }
        workflows.push(workflow.clone());
        self.projection.lock().expect("memory projection lock").update(workflow, &[]);
        Ok(())
    }

    async fn find(&self, id: &WorkflowId) -> RepoResult<Option<Workflow>> {
        Ok(match self.workflows.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .find(|w| &w.id == id)
        .cloned())
    }

    async fn list(&self, project_id: Option<&ProjectId>) -> RepoResult<Vec<Workflow>> {
        let workflows = match self.workflows.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        Ok(workflows.iter().rev().filter(|w| project_id.is_none_or(|id| &w.project_id == id)).cloned().collect())
    }

    async fn update(&self, workflow: &Workflow, expected_version: u64, events: &[RecordedEvent]) -> RepoResult<()> {
        let mut workflows = match self.workflows.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        match workflows.iter_mut().find(|w| w.id == workflow.id) {
            Some(stored) if stored.version == expected_version => {
                *stored = workflow.clone();
                self.projection.lock().expect("memory projection lock").update(workflow, events);
                match self.events.lock() {
                    Ok(value) => value,
                    Err(error) => panic!("expected lock to succeed: {error:?}"),
                }
                .extend_from_slice(events);
                Ok(())
            }
            _ => Err(RepositoryError::VersionConflict { expected: expected_version }),
        }
    }
}

#[async_trait]
impl AssignmentRepository for InMemoryStore {
    async fn find(&self, workflow_id: &WorkflowId) -> RepoResult<Assignments> {
        Ok(match self.assignments.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .get(workflow_id)
        .cloned()
        .unwrap_or_default())
    }

    async fn save(
        &self,
        workflow_id: &WorkflowId,
        assignments: &Assignments,
        expected_version: u64,
        changed_by: &UserId,
        _now_ms: i64,
    ) -> RepoResult<()> {
        let mut all = match self.assignments.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        };
        if all.get(workflow_id).map_or(0, |stored| stored.version) != expected_version {
            return Err(RepositoryError::VersionConflict { expected: expected_version });
        }
        all.insert(workflow_id.clone(), assignments.clone());
        match self.assignment_changes.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .push((workflow_id.clone(), assignments.version, changed_by.clone()));
        Ok(())
    }
}
