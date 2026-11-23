use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use process_flow_domain::ProjectId;
use process_flow_domain::membership::{Permission, Role, effective_role};
use process_flow_domain::user::Actor;

use process_flow_application::error::{AppResult, ApplicationError};
use process_flow_application::ports::{MembershipRepository, ProjectRepository};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Visible {
    All,
    Only(BTreeSet<ProjectId>),
}

impl Visible {
    pub fn contains(&self, project_id: &ProjectId) -> bool {
        match self {
            Self::All => true,
            Self::Only(ids) => ids.contains(project_id),
        }
    }
}

#[derive(Clone)]
pub struct ProjectAccess {
    memberships: Arc<dyn MembershipRepository>,
}

impl std::fmt::Debug for ProjectAccess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectAccess").finish_non_exhaustive()
    }
}

impl ProjectAccess {
    pub fn new(memberships: Arc<dyn MembershipRepository>) -> Self {
        Self { memberships }
    }

    pub async fn role(&self, actor: &Actor, project_id: &ProjectId) -> AppResult<Option<Role>> {
        if actor.is_admin {
            return Ok(effective_role(actor, None));
        }
        let memberships = self.memberships.memberships_of(&actor.user_id).await?;
        let membership = memberships.iter().find(|m| &m.project_id == project_id).map(|m| m.role);
        Ok(effective_role(actor, membership))
    }

    pub async fn require(
        &self,
        actor: &Actor,
        project_id: &ProjectId,
        permission: Permission,
        hidden: impl FnOnce() -> ApplicationError,
    ) -> AppResult<Role> {
        let role = self.role(actor, project_id).await?.ok_or_else(hidden)?;
        if role.allows(permission) {
            Ok(role)
        } else {
            Err(ApplicationError::Forbidden(format!("이 프로젝트에서 {} 역할로는 할 수 없습니다", role.as_str())))
        }
    }

    pub(crate) async fn require_workflow(
        &self,
        projects: &dyn ProjectRepository,
        actor: &Actor,
        project_id: &ProjectId,
        permission: Permission,
        hidden: impl Fn() -> ApplicationError,
    ) -> AppResult<(Role, bool)> {
        let role = self.require(actor, project_id, permission, &hidden).await?;
        let project = projects.find(project_id).await?.ok_or_else(hidden)?;
        if project.archived && permission != Permission::ViewProject {
            return Err(ApplicationError::Forbidden("보관된 프로젝트의 워크플로는 열람만 할 수 있습니다".into()));
        }
        Ok((role, project.archived))
    }

    pub async fn roles(&self, actor: &Actor) -> AppResult<BTreeMap<ProjectId, Role>> {
        let memberships = self.memberships.memberships_of(&actor.user_id).await?;
        Ok(memberships
            .into_iter()
            .filter_map(|m| effective_role(actor, Some(m.role)).map(|role| (m.project_id, role)))
            .collect())
    }

    pub async fn visible(&self, actor: &Actor) -> AppResult<Visible> {
        if actor.is_admin {
            return Ok(Visible::All);
        }
        let memberships = self.memberships.memberships_of(&actor.user_id).await?;
        Ok(Visible::Only(memberships.into_iter().map(|m| m.project_id).collect()))
    }
}

pub(crate) fn project_not_found(id: &ProjectId) -> ApplicationError {
    ApplicationError::NotFound { entity: "프로젝트", id: id.to_string() }
}
