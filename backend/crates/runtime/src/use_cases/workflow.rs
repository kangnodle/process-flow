use std::sync::Arc;

use process_flow_domain::assignment::Assignments;
use process_flow_domain::membership::{Permission, Role};
use process_flow_domain::process::Process;
use process_flow_domain::user::Actor;
use process_flow_domain::workflow::{Command, Event, Workflow};
use process_flow_domain::{ProcessId, ProjectId, WorkflowId};

use crate::access::{ProjectAccess, Visible, project_not_found};
use process_flow_application::contexts::workflow::{CommandValidation, ValidatedCommand, WorkflowCommandContext};
use process_flow_application::error::{AppResult, ApplicationError, RepositoryError};
use process_flow_application::ports::{
    AssignmentRepository, Clock, IdGenerator, PreferencesRepository, ProcessRepository, ProjectRepository,
    WorkflowRepository,
};
use process_flow_application::preferences::WorkspacePreferences;
use process_flow_application::workflow_policy::CommandPlan;

#[derive(Clone)]
pub struct WorkflowServiceDeps {
    pub workflows: Arc<dyn WorkflowRepository>,
    pub processes: Arc<dyn ProcessRepository>,
    pub projects: Arc<dyn ProjectRepository>,
    pub access: ProjectAccess,
    pub assignments: Arc<dyn AssignmentRepository>,
    pub preferences: Arc<dyn PreferencesRepository>,
    pub clock: Arc<dyn Clock>,
    pub ids: Arc<dyn IdGenerator>,
}

#[derive(Clone)]
pub struct WorkflowService {
    deps: WorkflowServiceDeps,
}

impl std::fmt::Debug for WorkflowServiceDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkflowServiceDeps").finish_non_exhaustive()
    }
}

impl std::fmt::Debug for WorkflowService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkflowService").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub struct OpenWorkflow {
    pub workflow: Workflow,
    pub process: Process,
    pub role: Role,
    pub project_archived: bool,
    pub assignments: Assignments,
}

#[derive(Debug, Clone)]
pub struct ExecuteOutcome {
    pub workflow: Workflow,
    pub process: Process,
    pub role: Role,
    pub assignments: Assignments,
    pub events: Vec<Event>,
}

impl WorkflowService {
    pub fn new(deps: WorkflowServiceDeps) -> Self {
        Self { deps }
    }

    pub async fn start(
        &self,
        actor: &Actor,
        project_id: &ProjectId,
        process_id: &ProcessId,
        name: Option<String>,
    ) -> AppResult<OpenWorkflow> {
        let project = self.load_project(project_id).await?;
        let role = self
            .deps
            .access
            .require(actor, project_id, Permission::StartWorkflow, || project_not_found(project_id))
            .await?;
        if project.archived {
            return Err(ApplicationError::Conflict(format!(
                "보관한 프로젝트에는 워크플로를 시작할 수 없습니다: {project_id}"
            )));
        }
        let process = self.load_process(process_id).await?;
        let name = name.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()).unwrap_or_else(|| "새 워크플로".into());
        let workflow = Workflow::start(WorkflowId::new(self.deps.ids.next_id()), project.id, process_id.clone(), name);
        self.deps.workflows.insert(&workflow, self.deps.clock.now_ms()).await?;
        Ok(OpenWorkflow { workflow, process, role, project_archived: false, assignments: Assignments::default() })
    }

    pub async fn list(&self, actor: &Actor, project_id: Option<&ProjectId>) -> AppResult<Vec<Workflow>> {
        if let Some(id) = project_id {
            self.load_project(id).await?;
            self.deps.access.require(actor, id, Permission::ViewProject, || project_not_found(id)).await?;
            return Ok(self.deps.workflows.list(Some(id)).await?);
        }
        Ok(match self.deps.access.visible(actor).await? {
            Visible::All => self.deps.workflows.list(None).await?,
            Visible::Only(ids) => {
                let ids: Vec<ProjectId> = ids.into_iter().collect();
                self.deps.workflows.list_in(&ids).await?
            }
        })
    }

    pub async fn get(&self, actor: &Actor, id: &WorkflowId) -> AppResult<OpenWorkflow> {
        self.open(actor, id, Permission::ViewProject).await
    }

    async fn open(&self, actor: &Actor, id: &WorkflowId, permission: Permission) -> AppResult<OpenWorkflow> {
        let workflow = self.load(id).await?;
        let hidden = || ApplicationError::NotFound { entity: "워크플로", id: id.to_string() };
        let (access, process, assignments) = futures_util::join!(
            self.deps.access.require_workflow(
                self.deps.projects.as_ref(),
                actor,
                &workflow.project_id,
                permission,
                hidden
            ),
            self.load_process(&workflow.process_id),
            self.deps.assignments.find(id),
        );
        let (role, project_archived) = access?;
        let process = process?;
        workflow
            .state
            .validate(&process)
            .map_err(|error| RepositoryError::Corrupted(format!("워크플로 {id}: {error}")))?;
        let assignments = assignments?;
        Ok(OpenWorkflow { workflow, process, role, project_archived, assignments })
    }

    pub async fn execute(
        &self,
        actor: &Actor,
        id: &WorkflowId,
        command: Command,
        expected_version: Option<u64>,
    ) -> AppResult<ExecuteOutcome> {
        self.execute_validated(
            actor,
            id,
            ValidatedCommand { command, validation: CommandValidation::Valid },
            expected_version,
        )
        .await
    }

    pub async fn execute_validated(
        &self,
        actor: &Actor,
        id: &WorkflowId,
        input: ValidatedCommand,
        expected_version: Option<u64>,
    ) -> AppResult<ExecuteOutcome> {
        let OpenWorkflow { workflow, process, role, assignments, .. } =
            self.open(actor, id, Permission::ExecuteCommand).await?;
        let context = WorkflowCommandContext {
            workflow: &workflow,
            process: &process,
            assignments: &assignments,
            actor: &actor.user_id,
            access_role: role,
        };
        let Some(plan) = context.plan(&input, expected_version)? else {
            return Ok(ExecuteOutcome { workflow, process, role, assignments, events: Vec::new() });
        };

        let recorded = plan.recorded_events(&actor.user_id, self.deps.clock.now_ms());
        let CommandPlan { workflow: updated, events, .. } = plan;
        self.deps.workflows.update(&updated, workflow.version, &recorded).await.map_err(|error| match error {
            RepositoryError::VersionConflict { expected } => ApplicationError::VersionConflict { expected },
            other => other.into(),
        })?;

        Ok(ExecuteOutcome { workflow: updated, process, role, assignments, events })
    }

    pub async fn preferences(&self, actor: &Actor, id: &WorkflowId) -> AppResult<WorkspacePreferences> {
        self.authorize(actor, id, Permission::ViewProject).await?;
        Ok(self.deps.preferences.find(id).await?)
    }

    pub async fn update_preferences(
        &self,
        actor: &Actor,
        id: &WorkflowId,
        patch: WorkspacePreferences,
    ) -> AppResult<WorkspacePreferences> {
        let workflow = self.authorize(actor, id, Permission::SavePreferences).await?;
        if let Some(task_id) = &patch.selected_task_id {
            self.load_process(&workflow.process_id)
                .await?
                .task(task_id)
                .map_err(|_| ApplicationError::Invalid(format!("공정에 없는 작업입니다: {task_id}")))?;
        }
        if patch.is_empty() {
            return Ok(self.deps.preferences.find(id).await?);
        }
        Ok(self.deps.preferences.merge(id, &patch, self.deps.clock.now_ms()).await?)
    }

    async fn authorize(&self, actor: &Actor, id: &WorkflowId, permission: Permission) -> AppResult<Workflow> {
        let workflow = self.load(id).await?;
        let hidden = || ApplicationError::NotFound { entity: "워크플로", id: id.to_string() };
        self.deps
            .access
            .require_workflow(self.deps.projects.as_ref(), actor, &workflow.project_id, permission, hidden)
            .await?;
        Ok(workflow)
    }

    async fn load(&self, id: &WorkflowId) -> AppResult<Workflow> {
        self.deps
            .workflows
            .find(id)
            .await?
            .ok_or_else(|| ApplicationError::NotFound { entity: "워크플로", id: id.to_string() })
    }

    async fn load_project(&self, id: &ProjectId) -> AppResult<process_flow_domain::project::Project> {
        self.deps.projects.find(id).await?.ok_or_else(|| project_not_found(id))
    }

    async fn load_process(&self, id: &ProcessId) -> AppResult<Process> {
        self.deps
            .processes
            .find(id)
            .await?
            .ok_or_else(|| ApplicationError::NotFound { entity: "공정", id: id.to_string() })
    }
}
