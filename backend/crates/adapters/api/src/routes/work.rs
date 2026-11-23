use actix_web::web::{Data, Json, ReqData};
use process_flow_domain::user::Actor;

use crate::dto::MyWorkDto;
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn mine(state: Data<ApiState>, actor: ReqData<Actor>) -> Result<Json<MyWorkDto>, ApiError> {
    let found = state.work.mine(&actor).await?;
    Ok(Json(MyWorkDto::new(&found)))
}
