use std::collections::BTreeMap;
use std::sync::Arc;

use process_flow_domain::membership::effective_role;
use process_flow_domain::process::Process;
use process_flow_domain::project::Project;
use process_flow_domain::user::Actor;
use process_flow_domain::work::{MyWork, my_work};
use process_flow_domain::workflow::Workflow;
use process_flow_domain::{ProcessId, ProjectId, WorkflowId};

use process_flow_application::error::AppResult;
use process_flow_application::ports::{
    AssignmentRepository, MembershipRepository, ProcessRepository, ProjectRepository, WorkflowRepository,
};

#[derive(Clone)]
pub struct WorkServiceDeps {
    pub memberships: Arc<dyn MembershipRepository>,
    pub projects: Arc<dyn ProjectRepository>,
    pub workflows: Arc<dyn WorkflowRepository>,
    pub processes: Arc<dyn ProcessRepository>,
    pub assignments: Arc<dyn AssignmentRepository>,
}

impl std::fmt::Debug for WorkServiceDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkServiceDeps").finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowWork {
    pub project: Project,
    pub workflow: Workflow,
    pub work: MyWork,
}

#[derive(Clone)]
pub struct WorkService {
    deps: WorkServiceDeps,
}

impl std::fmt::Debug for WorkService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkService").finish_non_exhaustive()
    }
}

impl WorkService {
    pub fn new(deps: WorkServiceDeps) -> Self {
        Self { deps }
    }

    pub async fn mine(&self, actor: &Actor) -> AppResult<Vec<WorkflowWork>> {
        let memberships = self.deps.memberships.memberships_of(&actor.user_id).await?;
        let ids: Vec<ProjectId> = memberships.iter().map(|m| m.project_id.clone()).collect();
        let projects: BTreeMap<ProjectId, Project> = self
            .deps
            .projects
            .find_many(&ids)
            .await?
            .into_iter()
            .filter(|project| !project.archived)
            .map(|project| (project.id.clone(), project))
            .collect();
        if projects.is_empty() {
            return Ok(Vec::new());
        }
        let open: Vec<ProjectId> = projects.keys().cloned().collect();

        let mut by_project: BTreeMap<ProjectId, Vec<Workflow>> = BTreeMap::new();
        for workflow in self.deps.workflows.list_in(&open).await? {
            by_project.entry(workflow.project_id.clone()).or_default().push(workflow);
        }
        by_project.values_mut().for_each(|workflows| workflows.reverse());

        let mut processes: BTreeMap<ProcessId, Option<Process>> = BTreeMap::new();
        for workflow in by_project.values().flatten() {
            if !processes.contains_key(&workflow.process_id) {
                let process = self.deps.processes.find(&workflow.process_id).await?;
                processes.insert(workflow.process_id.clone(), process);
            }
        }
        let valid = |workflow: &Workflow| matches!(processes.get(&workflow.process_id), Some(Some(process)) if workflow.state.validate(process).is_ok());
        let workflow_ids: Vec<WorkflowId> =
            by_project.values().flatten().filter(|w| valid(w)).map(|w| w.id.clone()).collect();
        let mut assignments = self.deps.assignments.find_many(&workflow_ids).await?;

        let mut found = Vec::new();
        for membership in memberships {
            let Some(project) = projects.get(&membership.project_id) else { continue };
            let Some(role) = effective_role(actor, Some(membership.role)) else { continue };
            for workflow in by_project.remove(&project.id).unwrap_or_default() {
                if !valid(&workflow) {
                    continue;
                }
                let Some(Some(process)) = processes.get(&workflow.process_id) else { continue };
                let assigned = assignments.remove(&workflow.id).unwrap_or_default();
                let work = my_work(process, &workflow.state, &assigned, &actor.user_id, role);
                if !work.is_empty() {
                    found.push(WorkflowWork { project: project.clone(), workflow, work });
                }
            }
        }
        Ok(found)
    }
}
