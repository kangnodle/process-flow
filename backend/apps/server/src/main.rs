mod config;
mod operation;
mod storage;
mod wiring;

use actix_cors::Cors;
use actix_web::middleware::{Logger, NormalizePath, TrailingSlash};
use actix_web::{App, HttpServer, http, web};
use process_flow_api::configure;
use tracing_subscriber::EnvFilter;

use crate::config::AppConfig;
use crate::wiring::{BoxError, build_state};

#[actix_web::main]
async fn main() -> Result<(), BoxError> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let config = AppConfig::from_lookup(|key| std::env::var(key).ok())?;
    let operation = operation::Operation::parse(std::env::args().skip(1)).map_err(std::io::Error::other)?;
    let storage = storage::Storage::open(&config).await?;
    match operation {
        operation::Operation::RebuildSearch => return storage::rebuild_search(&config, storage).await,
        operation::Operation::Serve => {}
    }
    let (state, worker) = build_state(&config, storage).await?;

    tracing::info!(host = %config.host, port = config.port, db = %config.sqlite.url, "process-flow API 서버 시작");
    let allowed_origins = config.allowed_origins.clone();
    let mut server = HttpServer::new(move || {
        App::new()
            .app_data(web::Data::new(state.clone()))
            .wrap(cors(&allowed_origins))
            .wrap(NormalizePath::new(TrailingSlash::Trim))
            .wrap(Logger::default())
            .configure(configure)
    })
    .bind((config.host.as_str(), config.port))?;
    if let Some(workers) = config.workers {
        server = server.workers(workers);
    }
    let result = server.run().await;
    worker.shutdown().await?;
    result?;
    Ok(())
}

fn cors(allowed_origins: &[String]) -> Cors {
    allowed_origins
        .iter()
        .fold(Cors::default(), |cors, origin| cors.allowed_origin(origin))
        .allowed_methods(vec!["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
        .allowed_headers(vec![http::header::CONTENT_TYPE, http::header::ACCEPT])
        .supports_credentials()
        .expose_headers(vec![http::header::LOCATION])
        .max_age(3600)
}
