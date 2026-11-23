use std::collections::BTreeMap;

use process_flow_application::preferences::{Locale, Theme, View, WorkspacePreferences};
use process_flow_domain::UserId;
use process_flow_domain::assignment::{Assignments, Authority, StageAssignment};
use process_flow_domain::membership::{Permission, Role};
use process_flow_domain::process::Process;
use process_flow_domain::project::{Project, ProjectPatch};
use process_flow_domain::user::{User, UserPatch};
use process_flow_domain::work::{Readiness, Watch, WorkItem, WorkTarget};
use process_flow_domain::workflow::{
    Command, Event, Evidence, FileEvidence, LinkEvidence, Phase, Progress, ReviewStatus, TaskDocument, TaskRecord,
    Workflow, overall_progress, stage_summaries,
};
use process_flow_runtime::{AccessibleProject, MemberEntry, ProjectEntry, RecordSearchHit, WorkflowWork};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDto {
    pub id: String,
    pub stages: Vec<StageDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageDto {
    pub id: String,
    pub index: usize,
    pub tasks: Vec<TaskDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub number: usize,
}

impl From<&Process> for ProcessDto {
    fn from(process: &Process) -> Self {
        Self {
            id: process.id().to_string(),
            stages: process
                .stages()
                .iter()
                .map(|stage| StageDto {
                    id: stage.id.to_string(),
                    index: stage.index,
                    tasks: stage.tasks.iter().map(|t| TaskDto { id: t.id.to_string(), number: t.number }).collect(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrerequisitesDto {
    pub task_id: String,
    pub prerequisites: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub description: String,
    pub archived: bool,
    pub version: u64,
    pub role: &'static str,
    pub permissions: Vec<&'static str>,
}

pub fn permission_names(role: Role) -> Vec<&'static str> {
    role.permissions().map(Permission::as_str).collect()
}

impl ProjectDto {
    pub fn new(project: &Project, role: Role) -> Self {
        Self {
            id: project.id.to_string(),
            name: project.name.clone(),
            description: project.description.clone(),
            archived: project.archived,
            version: project.version,
            role: role.as_str(),
            permissions: permission_names(role),
        }
    }
}

impl From<&AccessibleProject> for ProjectDto {
    fn from(accessible: &AccessibleProject) -> Self {
        Self::new(&accessible.project, accessible.role)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateProjectRequest {
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateProjectRequest {
    pub expected_version: Option<u64>,
    pub name: Option<String>,
    pub description: Option<String>,
    pub archived: Option<bool>,
}

impl UpdateProjectRequest {
    pub fn into_parts(self) -> (ProjectPatch, Option<u64>) {
        let patch = ProjectPatch { name: self.name, description: self.description, archived: self.archived };
        (patch, self.expected_version)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListProjectsQuery {
    #[serde(default)]
    pub include_archived: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: String,
    pub email: String,
    pub name: String,
    pub active: bool,
    pub is_admin: bool,
    pub version: u64,
}

impl From<&User> for UserDto {
    fn from(user: &User) -> Self {
        Self {
            id: user.id.to_string(),
            email: user.email.clone(),
            name: user.name.clone(),
            active: user.active,
            is_admin: user.is_admin,
            version: user.version,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateUserRequest {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetPasswordRequest {
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateUserRequest {
    pub expected_version: Option<u64>,
    pub email: Option<String>,
    pub name: Option<String>,
    pub active: Option<bool>,
    pub is_admin: Option<bool>,
}

impl UpdateUserRequest {
    pub fn into_parts(self) -> (UserPatch, Option<u64>) {
        let patch = UserPatch { email: self.email, name: self.name, active: self.active, is_admin: self.is_admin };
        (patch, self.expected_version)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListUsersQuery {
    #[serde(default)]
    pub include_inactive: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatusDto {
    pub setup_required: bool,
    pub user: Option<UserDto>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetupRequest {
    pub email: String,
    pub name: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}

pub fn parse_role(value: &str) -> Result<Role, String> {
    Role::parse(value).ok_or_else(|| {
        let allowed: Vec<_> = Role::ALL.iter().map(|role| role.as_str()).collect();
        format!("role은(는) {} 중 하나여야 합니다: {value}", allowed.join(", "))
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PutMemberRequest {
    pub role: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberDto {
    pub role: &'static str,
    pub user: UserDto,
}

impl From<&MemberEntry> for MemberDto {
    fn from(entry: &MemberEntry) -> Self {
        Self { role: entry.role.as_str(), user: UserDto::from(&entry.user) }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectDto {
    pub role: &'static str,
    pub project: ProjectDto,
}

impl From<&ProjectEntry> for UserProjectDto {
    fn from(entry: &ProjectEntry) -> Self {
        Self { role: entry.role.as_str(), project: ProjectDto::new(&entry.project, entry.role) }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartWorkflowRequest {
    pub project_id: Option<String>,
    pub process_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListWorkflowsQuery {
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressDto {
    pub done: usize,
    pub total: usize,
    pub ratio: f64,
}

impl From<Progress> for ProgressDto {
    fn from(p: Progress) -> Self {
        Self { done: p.done, total: p.total, ratio: p.ratio }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageStatusDto {
    pub id: String,
    pub index: usize,
    pub locked: bool,
    pub complete: bool,
    pub progress: ProgressDto,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecordDto {
    pub link: String,
    pub note: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document: Option<TaskDocumentDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Vec<EvidenceDto>>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PhaseDto {
    Working { stage_index: usize, completed: usize },
    AwaitingApproval { stage_index: usize },
    Finished,
}

impl From<Phase> for PhaseDto {
    fn from(phase: Phase) -> Self {
        match phase {
            Phase::Working { stage_index, completed } => Self::Working { stage_index, completed },
            Phase::AwaitingApproval { stage_index } => Self::AwaitingApproval { stage_index },
            Phase::Finished => Self::Finished,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReworkDto {
    pub until_number: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDto {
    pub id: String,
    pub project_id: String,
    pub project_archived: bool,
    pub process_id: String,
    pub name: String,
    pub version: u64,
    pub phase: PhaseDto,
    pub rework: Option<ReworkDto>,
    pub unlocked_stage: usize,
    pub done: Vec<String>,
    pub records: BTreeMap<String, TaskRecordDto>,
    pub progress: ProgressDto,
    pub stages: Vec<StageStatusDto>,
    pub role: &'static str,
    pub permissions: Vec<&'static str>,
    pub assignments: AssignmentsDto,
    pub authority: AuthorityDto,
}

impl WorkflowDto {
    pub fn new(
        workflow: &Workflow,
        process: &Process,
        role: Role,
        project_archived: bool,
        assignments: &Assignments,
        viewer: &UserId,
    ) -> Self {
        let state = &workflow.state;
        let workflow_role = if project_archived { Role::Viewer } else { role };
        Self {
            role: role.as_str(),
            permissions: permission_names(workflow_role),
            assignments: AssignmentsDto::from(assignments),
            authority: AuthorityDto::new(process, assignments, viewer, workflow_role),
            id: workflow.id.to_string(),
            project_id: workflow.project_id.to_string(),
            project_archived,
            process_id: workflow.process_id.to_string(),
            name: workflow.name.clone(),
            version: workflow.version,
            phase: state.phase.into(),
            rework: state
                .rework
                .as_ref()
                .map(|rework| ReworkDto { until_number: rework.until_number, reason: rework.reason.clone() }),
            unlocked_stage: state.phase.front_stage(process),
            done: state.done(process).map(ToString::to_string).collect(),
            records: state.records.iter().map(|(id, r)| (id.to_string(), TaskRecordDto::from(r))).collect(),
            progress: overall_progress(process, state).into(),
            stages: stage_summaries(process, state)
                .into_iter()
                .zip(process.stages())
                .map(|(summary, stage)| StageStatusDto {
                    id: stage.id.to_string(),
                    index: summary.index,
                    locked: summary.locked,
                    complete: summary.complete,
                    progress: summary.progress.into(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowSummaryDto {
    pub id: String,
    pub project_id: String,
    pub process_id: String,
    pub name: String,
    pub version: u64,
    pub phase: PhaseDto,
}

impl From<&Workflow> for WorkflowSummaryDto {
    fn from(workflow: &Workflow) -> Self {
        Self {
            id: workflow.id.to_string(),
            project_id: workflow.project_id.to_string(),
            process_id: workflow.process_id.to_string(),
            name: workflow.name.clone(),
            version: workflow.version,
            phase: workflow.state.phase.into(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CommandDto {
    CompleteTask { task_id: String },
    CompleteAndNext { task_id: String },
    ReopenTask { task_id: String },
    ApproveStage { stage_index: usize },
    RequestRework { task_id: String, reason: String },
    UpdateRecord { task_id: String, patch: RecordPatchDto },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordPatchDto {
    pub link: Option<String>,
    pub note: Option<String>,
    pub document: Option<TaskDocumentDto>,
    pub evidence: Option<Vec<EvidenceDto>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRequest {
    pub expected_version: Option<u64>,
    pub command: CommandDto,
}

impl CommandDto {
    pub fn into_domain(self) -> process_flow_application::contexts::workflow::ValidatedCommand {
        use process_flow_application::contexts::workflow::{CommandValidation, ValidatedCommand};
        let mut validation = CommandValidation::Valid;
        let command = match self {
            CommandDto::CompleteTask { task_id } | CommandDto::CompleteAndNext { task_id } => {
                Command::CompleteTask { task_id: task_id.into() }
            }
            CommandDto::ReopenTask { task_id } => Command::ReopenTask { task_id: task_id.into() },
            CommandDto::ApproveStage { stage_index } => Command::ApproveStage { stage_index },
            CommandDto::RequestRework { task_id, reason } => Command::RequestRework { task_id: task_id.into(), reason },
            CommandDto::UpdateRecord { task_id, patch } => Command::UpdateRecord {
                task_id: task_id.into(),
                link: patch.link,
                note: patch.note,
                document: patch.document.and_then(|value| match TaskDocument::try_from(value) {
                    Ok(document) => Some(document),
                    Err(error) => {
                        validation = CommandValidation::InvalidRecord(error);
                        None
                    }
                }),
                evidence: patch.evidence.and_then(|items| {
                    match items.into_iter().map(Evidence::try_from).collect::<Result<Vec<_>, _>>() {
                        Ok(evidence) => Some(evidence),
                        Err(error) => {
                            if matches!(validation, CommandValidation::Valid) {
                                validation = CommandValidation::InvalidRecord(error);
                            }
                            None
                        }
                    }
                }),
            },
        };
        ValidatedCommand { command, validation }
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EventDto {
    TaskCompleted { task_id: String, record: TaskRecordDto },
    TaskReopened { task_id: String },
    StageApproved { stage_index: usize },
    ApprovalRevoked { stage_index: usize },
    ReworkRequested { task_id: String, until_number: usize, reason: String },
    ReworkCompleted,
    RecordUpdated { task_id: String, record: TaskRecordDto },
}

impl From<&Event> for EventDto {
    fn from(event: &Event) -> Self {
        match event {
            Event::TaskCompleted { task_id, record } => {
                Self::TaskCompleted { task_id: task_id.to_string(), record: TaskRecordDto::from(record) }
            }
            Event::TaskReopened { task_id } => Self::TaskReopened { task_id: task_id.to_string() },
            Event::StageApproved { stage_index } => Self::StageApproved { stage_index: *stage_index },
            Event::ApprovalRevoked { stage_index } => Self::ApprovalRevoked { stage_index: *stage_index },
            Event::ReworkRequested { task_id, until_number, reason } => Self::ReworkRequested {
                task_id: task_id.to_string(),
                until_number: *until_number,
                reason: reason.clone(),
            },
            Event::ReworkCompleted => Self::ReworkCompleted,
            Event::RecordUpdated { task_id, record } => {
                Self::RecordUpdated { task_id: task_id.to_string(), record: TaskRecordDto::from(record) }
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResponse {
    pub changed: bool,
    pub events: Vec<EventDto>,
    pub workflow: WorkflowDto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StageAssignmentDto {
    pub stage_id: String,
    #[serde(default)]
    pub accountable: Option<String>,
    #[serde(default)]
    pub responsible: Vec<String>,
    #[serde(default)]
    pub consulted: Vec<String>,
    #[serde(default)]
    pub informed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskAssignmentDto {
    pub task_id: String,
    pub responsible: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentsDto {
    pub version: u64,
    pub stages: Vec<StageAssignmentDto>,
    pub tasks: Vec<TaskAssignmentDto>,
}

fn user_names<'a>(ids: impl IntoIterator<Item = &'a UserId>) -> Vec<String> {
    ids.into_iter().map(ToString::to_string).collect()
}

impl From<&Assignments> for AssignmentsDto {
    fn from(assignments: &Assignments) -> Self {
        Self {
            version: assignments.version,
            stages: assignments
                .stages
                .iter()
                .map(|(stage_id, stage)| StageAssignmentDto {
                    stage_id: stage_id.to_string(),
                    accountable: stage.accountable.as_ref().map(ToString::to_string),
                    responsible: user_names(&stage.responsible),
                    consulted: user_names(&stage.consulted),
                    informed: user_names(&stage.informed),
                })
                .collect(),
            tasks: assignments
                .tasks
                .iter()
                .map(|(task_id, responsible)| TaskAssignmentDto {
                    task_id: task_id.to_string(),
                    responsible: user_names(responsible),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplaceAssignmentsRequest {
    pub expected_version: Option<u64>,
    #[serde(default)]
    pub stages: Vec<StageAssignmentDto>,
    #[serde(default)]
    pub tasks: Vec<TaskAssignmentDto>,
}

impl ReplaceAssignmentsRequest {
    pub fn into_parts(self) -> Result<(Assignments, Option<u64>), String> {
        let users = |ids: Vec<String>| ids.into_iter().map(UserId::new).collect();
        let mut assignments = Assignments::default();
        for stage in self.stages {
            let entry = StageAssignment {
                accountable: stage.accountable.filter(|id| !id.is_empty()).map(UserId::new),
                responsible: users(stage.responsible),
                consulted: users(stage.consulted),
                informed: users(stage.informed),
            };
            if assignments.stages.insert(stage.stage_id.as_str().into(), entry).is_some() {
                return Err(format!("같은 단계가 두 번 있습니다: {}", stage.stage_id));
            }
        }
        for task in self.tasks {
            if assignments.tasks.insert(task.task_id.as_str().into(), users(task.responsible)).is_some() {
                return Err(format!("같은 작업이 두 번 있습니다: {}", task.task_id));
            }
        }
        Ok((assignments, self.expected_version))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityDto {
    pub tasks: BTreeMap<String, Option<&'static str>>,
    pub stages: BTreeMap<String, Option<&'static str>>,
}

impl AuthorityDto {
    pub fn new(process: &Process, assignments: &Assignments, viewer: &UserId, role: Role) -> Self {
        Self {
            tasks: process
                .tasks()
                .map(|task| {
                    let authority = assignments.task_authority(process, viewer, role, &task.id);
                    (task.id.to_string(), authority.map(Authority::as_str))
                })
                .collect(),
            stages: process
                .stages()
                .iter()
                .map(|stage| {
                    let authority = assignments.stage_authority(viewer, role, &stage.id);
                    (stage.id.to_string(), authority.map(Authority::as_str))
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WaitDto {
    #[serde(rename_all = "camelCase")]
    AfterTasks {
        remaining: usize,
    },
    StageLocked,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItemDto {
    pub project_id: String,
    pub project_name: String,
    pub workflow_id: String,
    pub workflow_name: String,
    pub group: &'static str,
    pub kind: &'static str,
    pub stage_id: String,
    pub stage_index: usize,
    pub task_id: Option<String>,
    pub task_number: Option<usize>,
    pub wait: Option<WaitDto>,
    pub rework: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MyWorkDto {
    pub items: Vec<WorkItemDto>,
}

impl WorkItemDto {
    fn blank(
        found: &WorkflowWork,
        group: &'static str,
        kind: &'static str,
        stage_id: String,
        stage_index: usize,
    ) -> Self {
        Self {
            project_id: found.project.id.to_string(),
            project_name: found.project.name.clone(),
            workflow_id: found.workflow.id.to_string(),
            workflow_name: found.workflow.name.clone(),
            group,
            kind,
            stage_id,
            stage_index,
            task_id: None,
            task_number: None,
            wait: None,
            rework: false,
        }
    }

    fn item(found: &WorkflowWork, item: &WorkItem, open: bool) -> Self {
        let wait = match item.readiness {
            Readiness::Ready => None,
            Readiness::AfterTasks { remaining } => Some(WaitDto::AfterTasks { remaining }),
            Readiness::StageLocked => Some(WaitDto::StageLocked),
        };
        let group = match (open, &wait) {
            (true, _) => "open",
            (false, None) => "ready",
            (false, Some(_)) => "waiting",
        };
        let (kind, task_id, task_number) = match &item.target {
            WorkTarget::Task { task_id, number } => ("task", Some(task_id.to_string()), Some(*number)),
            WorkTarget::Approval => ("approval", None, None),
        };
        Self {
            task_id,
            task_number,
            wait,
            rework: item.rework,
            ..Self::blank(found, group, kind, item.stage_id.to_string(), item.stage_index)
        }
    }
}

impl MyWorkDto {
    pub fn new(found: &[WorkflowWork]) -> Self {
        let mut items = Vec::new();
        for workflow in found {
            items.extend(workflow.work.assigned.iter().map(|item| WorkItemDto::item(workflow, item, false)));
            items.extend(workflow.work.open.iter().map(|item| WorkItemDto::item(workflow, item, true)));
            items.extend(workflow.work.watching.iter().map(|watching| {
                let kind = match watching.watch {
                    Watch::Consulted => "consulted",
                    Watch::Informed => "informed",
                };
                WorkItemDto::blank(workflow, "watching", kind, watching.stage_id.to_string(), watching.stage_index)
            }));
        }
        Self { items }
    }
}

#[derive(Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferencesDto {
    #[serde(default)]
    pub locale: Option<String>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub view: Option<String>,
    #[serde(default)]
    pub selected_task_id: Option<String>,
}

fn parse_field<T: Copy>(
    value: Option<String>,
    field: &str,
    all: &[T],
    as_str: fn(T) -> &'static str,
) -> Result<Option<T>, String> {
    value
        .map(|v| {
            all.iter().copied().find(|item| as_str(*item) == v).ok_or_else(|| {
                let allowed: Vec<_> = all.iter().map(|item| as_str(*item)).collect();
                format!("{field}은(는) {} 중 하나여야 합니다: {v}", allowed.join(", "))
            })
        })
        .transpose()
}

impl TryFrom<PreferencesDto> for WorkspacePreferences {
    type Error = String;

    fn try_from(dto: PreferencesDto) -> Result<Self, Self::Error> {
        Ok(Self {
            locale: parse_field(dto.locale, "locale", Locale::ALL, Locale::as_str)?,
            theme: parse_field(dto.theme, "theme", Theme::ALL, Theme::as_str)?,
            view: parse_field(dto.view, "view", View::ALL, View::as_str)?,
            selected_task_id: dto.selected_task_id.map(Into::into),
        })
    }
}

impl From<WorkspacePreferences> for PreferencesDto {
    fn from(preferences: WorkspacePreferences) -> Self {
        Self {
            locale: preferences.locale.map(|v| v.as_str().to_owned()),
            theme: preferences.theme.map(|v| v.as_str().to_owned()),
            view: preferences.view.map(|v| v.as_str().to_owned()),
            selected_task_id: preferences.selected_task_id.map(|id| id.into_inner()),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub q: String,
    pub workflow_id: Option<String>,
    pub limit: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitDto {
    pub workflow_id: String,
    pub task_id: String,
    pub text: String,
    pub score: f64,
}

impl From<RecordSearchHit> for SearchHitDto {
    fn from(hit: RecordSearchHit) -> Self {
        Self {
            workflow_id: hit.workflow_id.into_inner(),
            task_id: hit.task_id.into_inner(),
            text: hit.text,
            score: hit.score,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct SearchResponse {
    pub hits: Vec<SearchHitDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskDocumentDto {
    pub version: u32,
    pub answers: BTreeMap<String, String>,
    pub review_status: String,
}
impl TryFrom<TaskDocumentDto> for TaskDocument {
    type Error = process_flow_domain::RuleViolation;

    fn try_from(value: TaskDocumentDto) -> Result<Self, Self::Error> {
        let review_status = match value.review_status.as_str() {
            "pending" => ReviewStatus::Pending,
            "passed" => ReviewStatus::Passed,
            "blocked" => ReviewStatus::Blocked,
            _ => {
                return Err(process_flow_domain::RuleViolation::InvalidRecord(
                    "invalid document version, review status, or answer length".into(),
                ));
            }
        };
        Ok(Self { version: value.version, answers: value.answers, review_status })
    }
}
impl From<&TaskDocument> for TaskDocumentDto {
    fn from(value: &TaskDocument) -> Self {
        Self {
            version: value.version,
            answers: value.answers.clone(),
            review_status: match value.review_status {
                ReviewStatus::Pending => "pending",
                ReviewStatus::Passed => "passed",
                ReviewStatus::Blocked => "blocked",
            }
            .into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceDto {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
}
impl TryFrom<EvidenceDto> for Evidence {
    type Error = process_flow_domain::RuleViolation;

    fn try_from(value: EvidenceDto) -> Result<Self, Self::Error> {
        let invalid = |reason: &str| process_flow_domain::RuleViolation::InvalidRecord(reason.into());
        match value.kind.as_str() {
            "link"
                if value.file_name.is_none()
                    && value.media_type.is_none()
                    && value.size.is_none()
                    && value.base64.is_none() =>
            {
                Ok(Self::Link(LinkEvidence {
                    id: value.id,
                    title: value.title,
                    description: value.description,
                    url: value
                        .url
                        .ok_or_else(|| invalid("link evidence requires a safe HTTP(S) URL and no file data"))?,
                }))
            }
            "file" if value.url.is_none() => Ok(Self::File(FileEvidence {
                id: value.id,
                title: value.title,
                description: value.description,
                file_name: value.file_name.ok_or_else(|| invalid("file evidence needs a safe filename and no URL"))?,
                media_type: value.media_type,
                size: value.size.ok_or_else(|| invalid("file size does not match decoded bytes"))?,
                base64: value.base64.ok_or_else(|| invalid("file must be canonical base64 and at most 2 MiB"))?,
            })),
            "link" => Err(invalid("link evidence requires a safe HTTP(S) URL and no file data")),
            "file" => Err(invalid("file evidence needs a safe filename and no URL")),
            _ => Err(invalid("unknown evidence kind")),
        }
    }
}
impl From<&Evidence> for EvidenceDto {
    fn from(value: &Evidence) -> Self {
        match value {
            Evidence::Link(item) => Self {
                id: item.id.clone(),
                kind: "link".into(),
                title: item.title.clone(),
                description: item.description.clone(),
                url: Some(item.url.clone()),
                file_name: None,
                media_type: None,
                size: None,
                base64: None,
            },
            Evidence::File(item) => Self {
                id: item.id.clone(),
                kind: "file".into(),
                title: item.title.clone(),
                description: item.description.clone(),
                url: None,
                file_name: Some(item.file_name.clone()),
                media_type: item.media_type.clone(),
                size: Some(item.size),
                base64: Some(item.base64.clone()),
            },
        }
    }
}

impl From<&TaskRecord> for TaskRecordDto {
    fn from(record: &TaskRecord) -> Self {
        Self {
            link: record.link.clone(),
            note: record.note.clone(),
            document: record.document.as_ref().map(Into::into),
            evidence: record.evidence.as_ref().map(|items| items.iter().map(Into::into).collect()),
        }
    }
}

#[cfg(test)]
mod document_contract_tests {
    use super::*;
    use serde_json::{Value, json};

    #[test]
    fn valid_document_and_evidence_json_preserve_optional_fields() {
        for review in ["pending", "passed", "blocked"] {
            let source = json!({"version":1,"answers":{"goal":"Clear outcome"},"reviewStatus":review});
            let dto: TaskDocumentDto = serde_json::from_value(source.clone()).unwrap();
            let document = TaskDocument::try_from(dto).unwrap();
            assert_eq!(serde_json::to_value(TaskDocumentDto::from(&document)).unwrap(), source);
        }
        for media in [None, Some(""), Some("text/plain")] {
            let mut file = json!({"id":"file","kind":"file","title":"Proof","description":"Evidence","fileName":"proof.txt","size":1,"base64":"YQ=="});
            if let Some(media) = media {
                file["mediaType"] = json!(media);
            }
            for source in [
                file,
                json!({"id":"link","kind":"link","title":"Reference","description":"","url":"https://example.com"}),
            ] {
                let dto: EvidenceDto = serde_json::from_value(source.clone()).unwrap();
                let evidence = Evidence::try_from(dto).unwrap();
                let encoded: Value = serde_json::to_value(EvidenceDto::from(&evidence)).unwrap();
                assert_eq!(encoded, source);
            }
        }
    }
}
