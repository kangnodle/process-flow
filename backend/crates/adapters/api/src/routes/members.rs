use actix_web::HttpResponse;
use actix_web::web::{Data, Json, Path, ReqData};
use process_flow_domain::user::Actor;
use process_flow_domain::{ProjectId, UserId};

use crate::dto::{MemberDto, PutMemberRequest, parse_role};
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn list(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<String>,
) -> Result<Json<Vec<MemberDto>>, ApiError> {
    let members = state.memberships.members(&actor, &ProjectId::new(path.into_inner())).await?;
    Ok(Json(members.iter().map(MemberDto::from).collect()))
}

pub async fn put(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<(String, String)>,
    body: Json<PutMemberRequest>,
) -> Result<Json<MemberDto>, ApiError> {
    let (project_id, user_id) = path.into_inner();
    let role = parse_role(&body.role).map_err(ApiError::bad_request)?;
    let entry = state.memberships.put(&actor, &ProjectId::new(project_id), &UserId::new(user_id), role).await?;
    Ok(Json(MemberDto::from(&entry)))
}

pub async fn remove(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    path: Path<(String, String)>,
) -> Result<HttpResponse, ApiError> {
    let (project_id, user_id) = path.into_inner();
    state.memberships.remove(&actor, &ProjectId::new(project_id), &UserId::new(user_id)).await?;
    Ok(HttpResponse::NoContent().finish())
}
