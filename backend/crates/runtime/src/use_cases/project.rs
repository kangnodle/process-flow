use std::sync::Arc;

use process_flow_domain::ProjectId;
use process_flow_domain::membership::{Permission, Role};
use process_flow_domain::project::{Project, ProjectPatch};
use process_flow_domain::user::Actor;

use crate::access::{ProjectAccess, project_not_found};
use process_flow_application::error::{AppResult, ApplicationError, RepositoryError};
use process_flow_application::ports::{Clock, IdGenerator, ProjectRepository};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccessibleProject {
    pub project: Project,
    pub role: Role,
}

#[derive(Clone)]
pub struct ProjectService {
    projects: Arc<dyn ProjectRepository>,
    access: ProjectAccess,
    clock: Arc<dyn Clock>,
    ids: Arc<dyn IdGenerator>,
}

impl std::fmt::Debug for ProjectService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProjectService").finish_non_exhaustive()
    }
}

impl ProjectService {
    pub fn new(
        projects: Arc<dyn ProjectRepository>,
        access: ProjectAccess,
        clock: Arc<dyn Clock>,
        ids: Arc<dyn IdGenerator>,
    ) -> Self {
        Self { projects, access, clock, ids }
    }

    pub async fn create(&self, actor: &Actor, name: &str, description: Option<&str>) -> AppResult<AccessibleProject> {
        let project = Project::create(ProjectId::new(self.ids.next_id()), name, description)?;
        self.projects.insert(&project, Some(&actor.user_id), self.clock.now_ms()).await?;
        Ok(AccessibleProject { project, role: Role::Owner })
    }

    pub async fn create_unowned(&self, name: &str, description: Option<&str>) -> AppResult<Project> {
        let project = Project::create(ProjectId::new(self.ids.next_id()), name, description)?;
        self.projects.insert(&project, None, self.clock.now_ms()).await?;
        Ok(project)
    }

    pub async fn list(&self, actor: &Actor, include_archived: bool) -> AppResult<Vec<AccessibleProject>> {
        let projects = self.projects.list(include_archived).await?;
        let mut visible = Vec::new();
        if actor.is_admin {
            visible.extend(projects.into_iter().map(|project| AccessibleProject { project, role: Role::Owner }));
            return Ok(visible);
        }
        let roles = self.access.roles(actor).await?;
        visible.extend(
            projects
                .into_iter()
                .filter_map(|project| roles.get(&project.id).map(|role| AccessibleProject { role: *role, project })),
        );
        Ok(visible)
    }

    pub async fn get(&self, actor: &Actor, id: &ProjectId) -> AppResult<AccessibleProject> {
        self.load(actor, id, Permission::ViewProject).await
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: &ProjectId,
        patch: &ProjectPatch,
        expected_version: Option<u64>,
    ) -> AppResult<AccessibleProject> {
        let AccessibleProject { project, role } = self.load(actor, id, Permission::EditProject).await?;
        if let Some(expected) = expected_version.filter(|v| *v != project.version) {
            return Err(ApplicationError::VersionConflict { expected });
        }
        let Some(updated) = project.apply(patch)? else { return Ok(AccessibleProject { project, role }) };
        self.projects.update(&updated, project.version, self.clock.now_ms()).await.map_err(|error| match error {
            RepositoryError::VersionConflict { expected } => ApplicationError::VersionConflict { expected },
            other => other.into(),
        })?;
        Ok(AccessibleProject { project: updated, role })
    }

    pub async fn archive(&self, actor: &Actor, id: &ProjectId) -> AppResult<AccessibleProject> {
        self.update(actor, id, &ProjectPatch { archived: Some(true), ..Default::default() }, None).await
    }

    pub async fn delete_archived(&self, actor: &Actor, id: &ProjectId, expected: u64) -> AppResult<()> {
        let project = self.load(actor, id, Permission::EditProject).await?.project;
        if !project.archived {
            return Err(ApplicationError::Conflict("보관된 프로젝트만 삭제할 수 있습니다".into()));
        }
        if project.version != expected {
            return Err(ApplicationError::VersionConflict { expected });
        }
        self.projects.delete_archived(id, expected).await.map_err(|error| match error {
            RepositoryError::VersionConflict { expected } => ApplicationError::VersionConflict { expected },
            other => other.into(),
        })
    }

    async fn load(&self, actor: &Actor, id: &ProjectId, permission: Permission) -> AppResult<AccessibleProject> {
        let project = self.projects.find(id).await?.ok_or_else(|| project_not_found(id))?;
        let role = self.access.require(actor, id, permission, || project_not_found(id)).await?;
        Ok(AccessibleProject { project, role })
    }
}
