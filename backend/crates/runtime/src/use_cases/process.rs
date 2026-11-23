use std::sync::Arc;

use process_flow_domain::process::{Process, ProcessSpec, define_process};
use process_flow_domain::{ProcessId, TaskId};

use process_flow_application::error::{AppResult, ApplicationError};
use process_flow_application::ports::{ProcessGraph, ProcessRepository};

#[derive(Clone)]
pub struct ProcessService {
    processes: Arc<dyn ProcessRepository>,
    graph: Arc<dyn ProcessGraph>,
}

impl std::fmt::Debug for ProcessService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProcessService").finish_non_exhaustive()
    }
}

impl ProcessService {
    pub fn new(processes: Arc<dyn ProcessRepository>, graph: Arc<dyn ProcessGraph>) -> Self {
        Self { processes, graph }
    }

    pub async fn install(&self, spec: ProcessSpec) -> AppResult<Process> {
        let process = define_process(spec)?;
        match self.processes.find(process.id()).await? {
            Some(stored) if stored == process => Ok(stored),
            _ => {
                self.processes.save(&process).await?;
                Ok(process)
            }
        }
    }

    pub async fn get(&self, id: &ProcessId) -> AppResult<Process> {
        self.processes
            .find(id)
            .await?
            .ok_or_else(|| ApplicationError::NotFound { entity: "공정", id: id.to_string() })
    }

    pub async fn prerequisites(&self, id: &ProcessId, task_id: &TaskId) -> AppResult<Vec<TaskId>> {
        self.get(id).await?.task(task_id)?;
        Ok(self.graph.prerequisites(id, task_id).await?)
    }
}
