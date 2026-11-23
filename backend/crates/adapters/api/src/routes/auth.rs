use actix_web::web::{Data, Json};
use actix_web::{HttpRequest, HttpResponse};
use process_flow_application::ApplicationError;

use crate::dto::{AuthStatusDto, ChangePasswordRequest, LoginRequest, SetupRequest, UserDto};
use crate::error::ApiError;
use crate::session::{authenticate, expired_cookie, session_cookie, session_token};
use crate::state::ApiState;

pub async fn status(state: Data<ApiState>, request: HttpRequest) -> Result<Json<AuthStatusDto>, ApiError> {
    let user = match authenticate(&state, &request).await {
        Ok((authenticated, _)) => Some(UserDto::from(&authenticated.user)),
        Err(ApplicationError::Unauthenticated) => None,
        Err(other) => return Err(other.into()),
    };
    let setup_required = user.is_none() && state.auth.setup_required().await?;
    Ok(Json(AuthStatusDto { setup_required, user }))
}

pub async fn setup(state: Data<ApiState>, body: Json<SetupRequest>) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let grant = state.auth.setup(&body.email, &body.name, &body.password).await?;
    Ok(HttpResponse::Created().cookie(session_cookie(&state, &grant.token)).json(UserDto::from(&grant.user)))
}

pub async fn login(state: Data<ApiState>, body: Json<LoginRequest>) -> Result<HttpResponse, ApiError> {
    let body = body.into_inner();
    let grant = state.auth.login(&body.email, &body.password).await?;
    Ok(HttpResponse::Ok().cookie(session_cookie(&state, &grant.token)).json(UserDto::from(&grant.user)))
}

pub async fn logout(state: Data<ApiState>, request: HttpRequest) -> Result<HttpResponse, ApiError> {
    if let Some(token) = session_token(&request) {
        state.auth.logout(&token).await?;
    }
    Ok(HttpResponse::NoContent().cookie(expired_cookie(&state)).finish())
}

pub async fn change_password(
    state: Data<ApiState>,
    request: HttpRequest,
    body: Json<ChangePasswordRequest>,
) -> Result<HttpResponse, ApiError> {
    let (authenticated, token) = authenticate(&state, &request).await?;
    let body = body.into_inner();
    state.auth.change_password(&authenticated.actor(), &token, &body.current_password, &body.new_password).await?;
    Ok(HttpResponse::NoContent().finish())
}
