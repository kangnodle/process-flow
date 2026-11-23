use std::sync::Arc;

use process_flow_domain::membership::Permission;
use process_flow_domain::user::Actor;
use process_flow_domain::{TaskId, WorkflowId};

use crate::access::{ProjectAccess, Visible};
use process_flow_application::error::{AppResult, ApplicationError};
use process_flow_application::ports::{Embedder, WorkflowRepository};
use process_flow_application::search::{SearchSource, VectorIndex};

pub const MAX_LIMIT: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub struct RecordSearchHit {
    pub workflow_id: WorkflowId,
    pub task_id: TaskId,
    pub text: String,
    pub score: f64,
}

#[derive(Clone)]
pub struct SearchService {
    index: Arc<dyn VectorIndex>,
    source: Arc<dyn SearchSource>,
    embedder: Arc<dyn Embedder>,
    workflows: Arc<dyn WorkflowRepository>,
    access: ProjectAccess,
}

impl std::fmt::Debug for SearchService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SearchService").finish_non_exhaustive()
    }
}

impl SearchService {
    pub fn new(
        index: Arc<dyn VectorIndex>,
        source: Arc<dyn SearchSource>,
        embedder: Arc<dyn Embedder>,
        workflows: Arc<dyn WorkflowRepository>,
        access: ProjectAccess,
    ) -> Self {
        Self { index, source, embedder, workflows, access }
    }

    pub async fn search(
        &self,
        actor: &Actor,
        query: &str,
        workflow_id: Option<&WorkflowId>,
        limit: usize,
    ) -> AppResult<Vec<RecordSearchHit>> {
        let query = query.trim();
        if query.is_empty() {
            return Err(ApplicationError::Invalid("검색어가 비어 있습니다".into()));
        }
        let limit = limit.clamp(1, MAX_LIMIT);
        let scope = self.scope(actor, workflow_id).await?;
        if scope.as_ref().is_some_and(Vec::is_empty) {
            return Ok(Vec::new());
        }
        let vector = self.embedder.embed(query).await.map_err(ApplicationError::External)?;
        let mut candidate_limit = limit;
        loop {
            let candidates = self.index.nearest(&vector, scope.as_deref(), candidate_limit).await?;
            let exhausted = candidates.len() < candidate_limit;
            let mut hits = Vec::with_capacity(limit);
            let mut seen = std::collections::BTreeSet::new();
            for candidate in candidates {
                if !candidate.score.is_finite()
                    || candidate.score <= 0.0
                    || !seen.insert(candidate.document.key.clone())
                {
                    continue;
                }
                if self.source.current(&candidate.document.key).await?.as_ref() != Some(&candidate.document) {
                    continue;
                }
                hits.push(RecordSearchHit {
                    workflow_id: candidate.document.key.workflow_id,
                    task_id: candidate.document.key.task_id,
                    text: candidate.document.text,
                    score: candidate.score,
                });
                if hits.len() == limit {
                    return Ok(hits);
                }
            }
            if exhausted || candidate_limit == usize::MAX {
                return Ok(hits);
            }
            candidate_limit = candidate_limit.saturating_mul(2);
        }
    }

    async fn scope(&self, actor: &Actor, workflow_id: Option<&WorkflowId>) -> AppResult<Option<Vec<WorkflowId>>> {
        if let Some(id) = workflow_id {
            let missing = || ApplicationError::NotFound { entity: "워크플로", id: id.to_string() };
            let workflow = self.workflows.find(id).await?.ok_or_else(missing)?;
            self.access.require(actor, &workflow.project_id, Permission::ViewProject, missing).await?;
            return Ok(Some(vec![id.clone()]));
        }
        match self.access.visible(actor).await? {
            Visible::All => Ok(None),
            Visible::Only(ids) => {
                let ids: Vec<_> = ids.into_iter().collect();
                Ok(Some(self.workflows.list_in(&ids).await?.into_iter().map(|w| w.id).collect()))
            }
        }
    }
}
