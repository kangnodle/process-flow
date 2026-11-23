use std::collections::BTreeMap;
use std::sync::Arc;

use process_flow_domain::membership::{Membership, Permission, Role};
use process_flow_domain::project::Project;
use process_flow_domain::user::{Actor, User};
use process_flow_domain::{ProjectId, UserId};

use crate::access::{ProjectAccess, project_not_found};
use crate::use_cases::assignment::release_assignments;
use process_flow_application::contexts::membership::{MembershipChange, MembershipContext};
use process_flow_application::error::{AppResult, ApplicationError};
use process_flow_application::ports::{
    AssignmentRepository, Clock, MembershipRepository, ProjectRepository, UserRepository, WorkflowRepository,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberEntry {
    pub role: Role,
    pub user: User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectEntry {
    pub role: Role,
    pub project: Project,
}

#[derive(Clone)]
pub struct MembershipService {
    memberships: Arc<dyn MembershipRepository>,
    users: Arc<dyn UserRepository>,
    projects: Arc<dyn ProjectRepository>,
    workflows: Arc<dyn WorkflowRepository>,
    assignments: Arc<dyn AssignmentRepository>,
    access: ProjectAccess,
    clock: Arc<dyn Clock>,
}

impl std::fmt::Debug for MembershipService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MembershipService").finish_non_exhaustive()
    }
}

impl MembershipService {
    pub fn new(
        memberships: Arc<dyn MembershipRepository>,
        users: Arc<dyn UserRepository>,
        projects: Arc<dyn ProjectRepository>,
        workflows: Arc<dyn WorkflowRepository>,
        assignments: Arc<dyn AssignmentRepository>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        let access = ProjectAccess::new(memberships.clone());
        Self { memberships, users, projects, workflows, assignments, access, clock }
    }

    pub async fn members(&self, actor: &Actor, project_id: &ProjectId) -> AppResult<Vec<MemberEntry>> {
        self.load_project(actor, project_id, Permission::ViewProject).await?;
        let memberships = self.memberships.members(project_id).await?;
        let ids: Vec<UserId> = memberships.iter().map(|m| m.user_id.clone()).collect();
        let mut users: BTreeMap<UserId, User> =
            self.users.find_many(&ids).await?.into_iter().map(|user| (user.id.clone(), user)).collect();
        memberships
            .into_iter()
            .map(|membership| {
                let user = users.remove(&membership.user_id).ok_or_else(|| {
                    process_flow_application::RepositoryError::Corrupted(format!(
                        "멤버십이 없는 사용자를 가리킵니다: {}",
                        membership.user_id
                    ))
                })?;
                Ok(MemberEntry { role: membership.role, user })
            })
            .collect()
    }

    pub async fn projects_of(&self, actor: &Actor, user_id: &UserId) -> AppResult<Vec<ProjectEntry>> {
        if !actor.is_admin && &actor.user_id != user_id {
            return Err(ApplicationError::Forbidden("다른 사용자의 프로젝트는 볼 수 없습니다".into()));
        }
        self.load_user(user_id).await?;
        let memberships = self.memberships.memberships_of(user_id).await?;
        let ids: Vec<ProjectId> = memberships.iter().map(|m| m.project_id.clone()).collect();
        let mut projects: BTreeMap<ProjectId, Project> =
            self.projects.find_many(&ids).await?.into_iter().map(|project| (project.id.clone(), project)).collect();
        memberships
            .into_iter()
            .map(|membership| {
                let project = projects.remove(&membership.project_id).ok_or_else(|| {
                    process_flow_application::RepositoryError::Corrupted(format!(
                        "멤버십이 없는 프로젝트를 가리킵니다: {}",
                        membership.project_id
                    ))
                })?;
                Ok(ProjectEntry { role: membership.role, project })
            })
            .collect()
    }

    pub async fn put(
        &self,
        actor: &Actor,
        project_id: &ProjectId,
        user_id: &UserId,
        role: Role,
    ) -> AppResult<MemberEntry> {
        self.load_project(actor, project_id, Permission::ManageMembers).await?;
        let user = self.load_user(user_id).await?;
        let members = self.memberships.members(project_id).await?;
        let change = MembershipContext { members: &members, user: &user }.put(role)?;
        let MembershipChange::Save { release_execution } = change else {
            return Ok(MemberEntry { role, user });
        };
        let membership = Membership { project_id: project_id.clone(), user_id: user_id.clone(), role };
        let now = self.clock.now_ms();
        self.memberships.put(&membership, now).await?;
        if release_execution {
            self.release(project_id, user_id, true, actor, now).await?;
        }
        Ok(MemberEntry { role, user })
    }

    pub async fn remove(&self, actor: &Actor, project_id: &ProjectId, user_id: &UserId) -> AppResult<()> {
        self.load_project(actor, project_id, Permission::ManageMembers).await?;
        let members = self.memberships.members(project_id).await?;
        process_flow_application::contexts::membership::plan_member_removal(&members, user_id)?;
        self.memberships.remove(project_id, user_id).await?;
        self.release(project_id, user_id, false, actor, self.clock.now_ms()).await?;
        Ok(())
    }

    async fn load_project(&self, actor: &Actor, id: &ProjectId, permission: Permission) -> AppResult<Project> {
        let project = self.projects.find(id).await?.ok_or_else(|| project_not_found(id))?;
        self.access.require(actor, id, permission, || project_not_found(id)).await?;
        Ok(project)
    }

    async fn release(
        &self,
        project_id: &ProjectId,
        user_id: &UserId,
        keep_watching: bool,
        actor: &Actor,
        now_ms: i64,
    ) -> AppResult<usize> {
        release_assignments(
            self.workflows.as_ref(),
            self.assignments.as_ref(),
            project_id,
            user_id,
            keep_watching,
            &actor.user_id,
            now_ms,
        )
        .await
    }

    async fn load_user(&self, id: &UserId) -> AppResult<User> {
        self.users.find(id).await?.ok_or_else(|| ApplicationError::NotFound { entity: "사용자", id: id.to_string() })
    }
}
