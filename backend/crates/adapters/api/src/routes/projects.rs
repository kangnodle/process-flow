use actix_web::HttpResponse;
use actix_web::web::{Data, Json, Path, Query, ReqData};
use process_flow_domain::ProjectId;
use process_flow_domain::user::Actor;

use crate::dto::{CreateProjectRequest, ListProjectsQuery, ProjectDto, UpdateProjectRequest};
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn list(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    query: Query<ListProjectsQuery>,
) -> Result<Json<Vec<ProjectDto>>, ApiError> {
    let projects = state.projects.list(&actor, query.include_archived).await?;
    Ok(Json(projects.iter().map(ProjectDto::from).collect()))
}

pub async fn create(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    body: Json<CreateProjectRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let created = state.projects.create(&actor, &body.name, body.description.as_deref()).await?;
    Ok(HttpResponse::Created()
        .insert_header(("Location", format!("/api/v1/projects/{}", created.project.id)))
        .json(ProjectDto::from(&created)))
}

pub async fn get(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<ProjectDto>, ApiError> {
    let project = state.projects.get(&actor, &ProjectId::new(path.into_inner())).await?;
    Ok(Json(ProjectDto::from(&project)))
}

pub async fn update(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<UpdateProjectRequest>,
) -> Result<Json<ProjectDto>, ApiError> {
    let (patch, expected_version) = body.into_inner().into_parts();
    let project = state.projects.update(&actor, &ProjectId::new(path.into_inner()), &patch, expected_version).await?;
    Ok(Json(ProjectDto::from(&project)))
}

pub async fn archive(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<ProjectDto>, ApiError> {
    let project = state.projects.archive(&actor, &ProjectId::new(path.into_inner())).await?;
    Ok(Json(ProjectDto::from(&project)))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProject {
    expected_version: u64,
}

pub async fn delete_permanently(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<DeleteProject>,
) -> Result<actix_web::HttpResponse, ApiError> {
    state.projects.delete_archived(&actor, &ProjectId::new(path.into_inner()), body.expected_version).await?;
    Ok(actix_web::HttpResponse::NoContent().finish())
}
