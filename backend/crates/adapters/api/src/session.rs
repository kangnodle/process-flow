use actix_web::body::MessageBody;
use actix_web::cookie::time::Duration;
use actix_web::cookie::{Cookie, SameSite};
use actix_web::dev::{ServiceRequest, ServiceResponse};
use actix_web::middleware::Next;
use actix_web::web::Data;
use actix_web::{Error, HttpMessage, HttpRequest, ResponseError};
use process_flow_application::ApplicationError;
use process_flow_runtime::Authenticated;

use crate::error::ApiError;
use crate::state::{ApiState, CookieSettings};

pub const SESSION_COOKIE: &str = "pf_session";

fn cookie(settings: CookieSettings, value: String, max_age: Duration) -> Cookie<'static> {
    Cookie::build(SESSION_COOKIE, value)
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(settings.secure)
        .max_age(max_age)
        .finish()
}

pub fn session_cookie(state: &ApiState, token: &str) -> Cookie<'static> {
    cookie(state.cookies, token.to_owned(), Duration::milliseconds(state.auth.session_ttl_ms()))
}

pub fn expired_cookie(state: &ApiState) -> Cookie<'static> {
    cookie(state.cookies, String::new(), Duration::ZERO)
}

pub fn session_token(request: &HttpRequest) -> Option<String> {
    request.cookie(SESSION_COOKIE).map(|cookie| cookie.value().to_owned()).filter(|token| !token.is_empty())
}

pub async fn authenticate(
    state: &ApiState,
    request: &HttpRequest,
) -> Result<(Authenticated, String), ApplicationError> {
    let token = session_token(request).ok_or(ApplicationError::Unauthenticated)?;
    let authenticated = state.auth.authenticate(&token).await?;
    Ok((authenticated, token))
}

pub async fn require_session(
    request: ServiceRequest,
    next: Next<impl MessageBody + 'static>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let state = request
        .app_data::<Data<ApiState>>()
        .cloned()
        .ok_or_else(|| actix_web::error::ErrorInternalServerError("ApiState가 등록되지 않았습니다"))?;
    match authenticate(&state, request.request()).await {
        Ok((authenticated, token)) => {
            request.extensions_mut().insert(authenticated.actor());
            let mut response = next.call(request).await?;
            if authenticated.renewed_until_ms.is_some() {
                response.response_mut().add_cookie(&session_cookie(&state, &token))?;
            }
            Ok(response.map_into_left_body())
        }
        Err(error) => {
            let had_cookie = session_token(request.request()).is_some();
            let unauthenticated = matches!(error, ApplicationError::Unauthenticated);
            let mut response = ApiError::from(error).error_response();
            if had_cookie && unauthenticated {
                response.add_cookie(&expired_cookie(&state))?;
            }
            Ok(request.into_response(response).map_into_right_body())
        }
    }
}
