mod auth;
mod health;
mod members;
mod processes;
mod projects;
mod search;
mod users;
mod work;
mod workflows;

use actix_web::middleware::from_fn;
use actix_web::{HttpRequest, error, web};

use crate::error::ApiError;
use crate::session::require_session;

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.app_data(web::JsonConfig::default().limit(16 * 1024 * 1024).error_handler(json_error))
        .app_data(web::QueryConfig::default().error_handler(query_error))
        .app_data(web::PathConfig::default().error_handler(path_error))
        .route("/health", web::get().to(health::health))
        .service(
            web::scope("/api/v1")
                .service(
                    web::scope("/auth")
                        .route("/status", web::get().to(auth::status))
                        .route("/setup", web::post().to(auth::setup))
                        .route("/login", web::post().to(auth::login))
                        .route("/logout", web::post().to(auth::logout))
                        .route("/password", web::post().to(auth::change_password)),
                )
                .service(
                    web::scope("")
                        .wrap(from_fn(require_session))
                        .route("/processes/{process_id}", web::get().to(processes::get))
                        .route(
                            "/processes/{process_id}/tasks/{task_id}/prerequisites",
                            web::get().to(processes::prerequisites),
                        )
                        .route("/projects", web::get().to(projects::list))
                        .route("/projects", web::post().to(projects::create))
                        .route("/projects/{project_id}", web::get().to(projects::get))
                        .route("/projects/{project_id}", web::patch().to(projects::update))
                        .route("/projects/{project_id}", web::delete().to(projects::archive))
                        .route("/projects/{project_id}/permanent", web::delete().to(projects::delete_permanently))
                        .route("/projects/{project_id}/workflows", web::get().to(workflows::list_in_project))
                        .route("/projects/{project_id}/workflows", web::post().to(workflows::start_in_project))
                        .route("/projects/{project_id}/members", web::get().to(members::list))
                        .route("/projects/{project_id}/members/{user_id}", web::put().to(members::put))
                        .route("/projects/{project_id}/members/{user_id}", web::delete().to(members::remove))
                        .route("/users", web::get().to(users::list))
                        .route("/users", web::post().to(users::create))
                        .route("/users/{user_id}", web::get().to(users::get))
                        .route("/users/{user_id}", web::patch().to(users::update))
                        .route("/users/{user_id}", web::delete().to(users::deactivate))
                        .route("/users/{user_id}/password", web::put().to(users::set_password))
                        .route("/users/{user_id}/projects", web::get().to(users::projects))
                        .route("/workflows", web::get().to(workflows::list))
                        .route("/workflows", web::post().to(workflows::start))
                        .route("/workflows/{workflow_id}", web::get().to(workflows::get))
                        .route("/workflows/{workflow_id}/commands", web::post().to(workflows::execute))
                        .route("/workflows/{workflow_id}/assignments", web::get().to(workflows::get_assignments))
                        .route("/workflows/{workflow_id}/assignments", web::put().to(workflows::replace_assignments))
                        .route("/workflows/{workflow_id}/preferences", web::get().to(workflows::get_preferences))
                        .route("/workflows/{workflow_id}/preferences", web::patch().to(workflows::update_preferences))
                        .route("/me/work", web::get().to(work::mine))
                        .route("/search/records", web::get().to(search::records)),
                ),
        );
}

fn json_error(err: error::JsonPayloadError, _: &HttpRequest) -> error::Error {
    ApiError::bad_request(format!("JSON 본문이 올바르지 않습니다: {err}")).into()
}

fn query_error(err: error::QueryPayloadError, _: &HttpRequest) -> error::Error {
    ApiError::bad_request(format!("쿼리 문자열이 올바르지 않습니다: {err}")).into()
}

fn path_error(err: error::PathError, _: &HttpRequest) -> error::Error {
    ApiError::bad_request(format!("경로가 올바르지 않습니다: {err}")).into()
}
