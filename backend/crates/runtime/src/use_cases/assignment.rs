use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use process_flow_domain::assignment::Assignments;
use process_flow_domain::membership::{Permission, Role};
use process_flow_domain::user::Actor;
use process_flow_domain::workflow::Workflow;
use process_flow_domain::{ProjectId, UserId, WorkflowId};

use crate::access::ProjectAccess;
use process_flow_application::error::{AppResult, ApplicationError, RepositoryError};
use process_flow_application::ports::{
    AssignmentRepository, Clock, MembershipRepository, ProcessRepository, ProjectRepository, UserRepository,
    WorkflowRepository,
};

#[derive(Clone)]
pub struct AssignmentServiceDeps {
    pub assignments: Arc<dyn AssignmentRepository>,
    pub workflows: Arc<dyn WorkflowRepository>,
    pub processes: Arc<dyn ProcessRepository>,
    pub projects: Arc<dyn ProjectRepository>,
    pub memberships: Arc<dyn MembershipRepository>,
    pub users: Arc<dyn UserRepository>,
    pub access: ProjectAccess,
    pub clock: Arc<dyn Clock>,
}

impl std::fmt::Debug for AssignmentServiceDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssignmentServiceDeps").finish_non_exhaustive()
    }
}

#[derive(Clone)]
pub struct AssignmentService {
    deps: AssignmentServiceDeps,
}

impl std::fmt::Debug for AssignmentService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AssignmentService").finish_non_exhaustive()
    }
}

impl AssignmentService {
    pub fn new(deps: AssignmentServiceDeps) -> Self {
        Self { deps }
    }

    pub async fn get(&self, actor: &Actor, workflow_id: &WorkflowId) -> AppResult<Assignments> {
        self.open(actor, workflow_id, Permission::ViewProject).await?;
        Ok(self.deps.assignments.find(workflow_id).await?)
    }

    pub async fn replace(
        &self,
        actor: &Actor,
        workflow_id: &WorkflowId,
        proposed: Assignments,
        expected_version: Option<u64>,
    ) -> AppResult<Assignments> {
        let workflow = self.open(actor, workflow_id, Permission::ManageAssignments).await?;
        let current = self.deps.assignments.find(workflow_id).await?;
        if let Some(expected) = expected_version.filter(|v| *v != current.version) {
            return Err(ApplicationError::VersionConflict { expected });
        }
        let process = self
            .deps
            .processes
            .find(&workflow.process_id)
            .await?
            .ok_or_else(|| ApplicationError::NotFound { entity: "공정", id: workflow.process_id.to_string() })?;
        let next = Assignments { version: current.version, ..proposed }.validated(&process)?;
        if next == current {
            return Ok(current);
        }
        self.ensure_assignable(&workflow.project_id, &next).await?;

        let next = Assignments { version: current.version + 1, ..next };
        let now = self.deps.clock.now_ms();
        self.deps.assignments.save(workflow_id, &next, current.version, &actor.user_id, now).await.map_err(
            |error| match error {
                RepositoryError::VersionConflict { expected } => ApplicationError::VersionConflict { expected },
                other => other.into(),
            },
        )?;
        Ok(next)
    }

    async fn ensure_assignable(&self, project_id: &ProjectId, assignments: &Assignments) -> AppResult<()> {
        let roles: BTreeMap<UserId, Role> =
            self.deps.memberships.members(project_id).await?.into_iter().map(|m| (m.user_id, m.role)).collect();
        let executors = assignments.executors();
        let everyone: Vec<UserId> = assignments.everyone().into_iter().collect();
        let active: BTreeSet<UserId> = self
            .deps
            .users
            .find_many(&everyone)
            .await?
            .into_iter()
            .filter(|user| user.active)
            .map(|user| user.id)
            .collect();
        for user_id in everyone {
            let Some(role) = roles.get(&user_id) else {
                return Err(ApplicationError::Invalid(format!("프로젝트 멤버가 아닌 사용자입니다: {user_id}")));
            };
            if executors.contains(&user_id) && !role.allows(Permission::ExecuteCommand) {
                return Err(ApplicationError::Invalid(format!(
                    "보기 전용 멤버에게는 담당(R)·승인(A)을 맡길 수 없습니다: {user_id}"
                )));
            }
            if !active.contains(&user_id) {
                return Err(ApplicationError::Invalid(format!("비활성 사용자에게는 맡길 수 없습니다: {user_id}")));
            }
        }
        Ok(())
    }

    async fn open(&self, actor: &Actor, id: &WorkflowId, permission: Permission) -> AppResult<Workflow> {
        let hidden = || ApplicationError::NotFound { entity: "워크플로", id: id.to_string() };
        let workflow = self.deps.workflows.find(id).await?.ok_or_else(hidden)?;
        self.deps
            .access
            .require_workflow(self.deps.projects.as_ref(), actor, &workflow.project_id, permission, hidden)
            .await?;
        Ok(workflow)
    }
}

pub(crate) async fn release_assignments(
    workflows: &dyn WorkflowRepository,
    assignments: &dyn AssignmentRepository,
    project_id: &ProjectId,
    user_id: &UserId,
    keep_watching: bool,
    changed_by: &UserId,
    now_ms: i64,
) -> AppResult<usize> {
    let ids: Vec<WorkflowId> = workflows.list(Some(project_id)).await?.into_iter().map(|w| w.id).collect();
    let mut current_by_workflow = assignments.find_many(&ids).await?;
    let mut changed = 0;
    for id in ids {
        let current = current_by_workflow.remove(&id).unwrap_or_default();
        let Some(next) = current.without(user_id, keep_watching) else { continue };
        assignments.save(&id, &next, current.version, changed_by, now_ms).await?;
        changed += 1;
    }
    Ok(changed)
}
