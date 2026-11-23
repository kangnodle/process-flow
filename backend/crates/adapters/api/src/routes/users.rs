use actix_web::HttpResponse;
use actix_web::web::{Data, Json, Path, Query, ReqData};
use process_flow_domain::UserId;
use process_flow_domain::user::Actor;

use crate::dto::{CreateUserRequest, ListUsersQuery, SetPasswordRequest, UpdateUserRequest, UserDto, UserProjectDto};
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn list(state: Data<ApiState>, query: Query<ListUsersQuery>) -> Result<Json<Vec<UserDto>>, ApiError> {
    let users = state.users.list(query.include_inactive).await?;
    Ok(Json(users.iter().map(UserDto::from).collect()))
}

pub async fn create(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    body: Json<CreateUserRequest>,
) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let user = state.users.create(&actor, &body.email, &body.name, &body.password).await?;
    Ok(HttpResponse::Created()
        .insert_header(("Location", format!("/api/v1/users/{}", user.id)))
        .json(UserDto::from(&user)))
}

pub async fn get(state: Data<ApiState>, path: Path<String>) -> Result<Json<UserDto>, ApiError> {
    let user = state.users.get(&UserId::new(path.into_inner())).await?;
    Ok(Json(UserDto::from(&user)))
}

pub async fn update(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<UpdateUserRequest>,
) -> Result<Json<UserDto>, ApiError> {
    let (patch, expected_version) = body.into_inner().into_parts();
    let user = state.users.update(&actor, &UserId::new(path.into_inner()), &patch, expected_version).await?;
    Ok(Json(UserDto::from(&user)))
}

pub async fn deactivate(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<UserDto>, ApiError> {
    let user = state.users.deactivate(&actor, &UserId::new(path.into_inner())).await?;
    Ok(Json(UserDto::from(&user)))
}

pub async fn set_password(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
    body: Json<SetPasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    state.users.set_password(&actor, &UserId::new(path.into_inner()), &body.password).await?;
    Ok(HttpResponse::NoContent().finish())
}

pub async fn projects(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<Vec<UserProjectDto>>, ApiError> {
    let entries = state.memberships.projects_of(&actor, &UserId::new(path.into_inner())).await?;
    Ok(Json(entries.iter().map(UserProjectDto::from).collect()))
}
