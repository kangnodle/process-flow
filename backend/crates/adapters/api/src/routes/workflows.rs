use actix_web::HttpResponse;
use actix_web::web::{Data, Json, Path, Query, ReqData};
use process_flow_domain::process::standard::STANDARD_PROCESS_ID;
use process_flow_domain::user::Actor;
use process_flow_domain::{ProcessId, ProjectId, WorkflowId};

use crate::dto::{
    AssignmentsDto, CommandRequest, CommandResponse, EventDto, ListWorkflowsQuery, PreferencesDto,
    ReplaceAssignmentsRequest, StartWorkflowRequest, WorkflowDto, WorkflowSummaryDto,
};
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn list(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    query: Query<ListWorkflowsQuery>,
) -> Result<Json<Vec<WorkflowSummaryDto>>, ApiError> {
    let project_id = query.into_inner().project_id.map(ProjectId::new);
    list_in(&state, &actor, project_id.as_ref()).await
}

pub async fn list_in_project(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<Vec<WorkflowSummaryDto>>, ApiError> {
    list_in(&state, &actor, Some(&ProjectId::new(path.into_inner()))).await
}

async fn list_in(
    state: &ApiState,
    actor: &Actor,
    project_id: Option<&ProjectId>,
) -> Result<Json<Vec<WorkflowSummaryDto>>, ApiError> {
    let workflows = state.workflows.list(actor, project_id).await?;
    Ok(Json(workflows.iter().map(WorkflowSummaryDto::from).collect()))
}

pub async fn start(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    body: Json<StartWorkflowRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let project_id = ProjectId::new(
        body.project_id
            .clone()
            .ok_or_else(|| ApiError::bad_request("projectId가 필요합니다. 워크플로는 프로젝트 안에 시작합니다"))?,
    );
    start_in(&state, &actor, &project_id, body).await
}

pub async fn start_in_project(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<StartWorkflowRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    if body.project_id.is_some() {
        return Err(ApiError::bad_request("projectId는 경로로 줍니다. 본문에서 빼 주세요"));
    }
    start_in(&state, &actor, &ProjectId::new(path.into_inner()), body).await
}

async fn start_in(
    state: &ApiState,
    actor: &Actor,
    project_id: &ProjectId,
    body: StartWorkflowRequest,
) -> Result<HttpResponse, ApiError> {
    let process_id = ProcessId::new(body.process_id.unwrap_or_else(|| STANDARD_PROCESS_ID.into()));
    let open = state.workflows.start(actor, project_id, &process_id, body.name).await?;
    Ok(HttpResponse::Created().insert_header(("Location", format!("/api/v1/workflows/{}", open.workflow.id))).json(
        WorkflowDto::new(
            &open.workflow,
            &open.process,
            open.role,
            open.project_archived,
            &open.assignments,
            &actor.user_id,
        ),
    ))
}

pub async fn get(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<WorkflowDto>, ApiError> {
    let open = state.workflows.get(&actor, &WorkflowId::new(path.into_inner())).await?;
    Ok(Json(WorkflowDto::new(
        &open.workflow,
        &open.process,
        open.role,
        open.project_archived,
        &open.assignments,
        &actor.user_id,
    )))
}

pub async fn execute(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<CommandRequest>,
) -> Result<Json<CommandResponse>, ApiError> {
    let CommandRequest { expected_version, command } = body.into_inner();
    let outcome = state
        .workflows
        .execute_validated(&actor, &WorkflowId::new(path.into_inner()), command.into_domain(), expected_version)
        .await?;
    Ok(Json(CommandResponse {
        changed: !outcome.events.is_empty(),
        events: outcome.events.iter().map(EventDto::from).collect(),
        workflow: WorkflowDto::new(
            &outcome.workflow,
            &outcome.process,
            outcome.role,
            false,
            &outcome.assignments,
            &actor.user_id,
        ),
    }))
}

pub async fn get_preferences(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<PreferencesDto>, ApiError> {
    let preferences = state.workflows.preferences(&actor, &WorkflowId::new(path.into_inner())).await?;
    Ok(Json(preferences.into()))
}

pub async fn update_preferences(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<PreferencesDto>,
) -> Result<Json<PreferencesDto>, ApiError> {
    let patch = body.into_inner().try_into().map_err(ApiError::bad_request)?;
    let preferences = state.workflows.update_preferences(&actor, &WorkflowId::new(path.into_inner()), patch).await?;
    Ok(Json(preferences.into()))
}

pub async fn get_assignments(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<AssignmentsDto>, ApiError> {
    let assignments = state.assignments.get(&actor, &WorkflowId::new(path.into_inner())).await?;
    Ok(Json(AssignmentsDto::from(&assignments)))
}

pub async fn replace_assignments(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<ReplaceAssignmentsRequest>,
) -> Result<Json<AssignmentsDto>, ApiError> {
    let (proposed, expected_version) = body.into_inner().into_parts().map_err(ApiError::bad_request)?;
    let saved =
        state.assignments.replace(&actor, &WorkflowId::new(path.into_inner()), proposed, expected_version).await?;
    Ok(Json(AssignmentsDto::from(&saved)))
}
