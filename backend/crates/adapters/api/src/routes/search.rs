use actix_web::web::{Data, Json, Query, ReqData};
use process_flow_domain::WorkflowId;
use process_flow_domain::user::Actor;

use crate::dto::{SearchHitDto, SearchQuery, SearchResponse};
use crate::error::ApiError;
use crate::state::ApiState;

const DEFAULT_LIMIT: usize = 10;

pub async fn records(
    state: Data<ApiState>,
    actor: ReqData<Actor>,
    query: Query<SearchQuery>,
) -> Result<Json<SearchResponse>, ApiError> {
    let SearchQuery { q, workflow_id, limit } = query.into_inner();
    let workflow_id = workflow_id.map(WorkflowId::new);
    let hits = state.search.search(&actor, &q, workflow_id.as_ref(), limit.unwrap_or(DEFAULT_LIMIT)).await?;
    Ok(Json(SearchResponse { hits: hits.into_iter().map(SearchHitDto::from).collect() }))
}
