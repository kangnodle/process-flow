use actix_web::web::{Data, Json, Path};
use process_flow_domain::{ProcessId, TaskId};

use crate::dto::{PrerequisitesDto, ProcessDto};
use crate::error::ApiError;
use crate::state::ApiState;

pub async fn get(state: Data<ApiState>, path: Path<String>) -> Result<Json<ProcessDto>, ApiError> {
    let process = state.processes.get(&ProcessId::new(path.into_inner())).await?;
    Ok(Json(ProcessDto::from(&process)))
}

pub async fn prerequisites(
    state: Data<ApiState>,
    path: Path<(String, String)>,
) -> Result<Json<PrerequisitesDto>, ApiError> {
    let (process_id, task_id) = path.into_inner();
    let task_id = TaskId::new(task_id);
    let prerequisites = state.processes.prerequisites(&ProcessId::new(process_id), &task_id).await?;
    Ok(Json(PrerequisitesDto {
        task_id: task_id.into_inner(),
        prerequisites: prerequisites.into_iter().map(TaskId::into_inner).collect(),
    }))
}
