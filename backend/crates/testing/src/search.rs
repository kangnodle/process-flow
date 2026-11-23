use std::collections::BTreeMap;

use async_trait::async_trait;
use process_flow_application::ports::RepoResult;
use process_flow_application::search::{
    SearchCandidate, SearchDocument, SearchJob, SearchJobs, SearchKey, SearchSource, VectorIndex,
};
use process_flow_domain::WorkflowId;
use process_flow_domain::workflow::Workflow;

use crate::store::InMemoryStore;

#[derive(Debug, Default)]
pub(crate) struct MemoryProjection {
    sequence: u64,
    documents: BTreeMap<SearchKey, SearchDocument>,
    jobs: BTreeMap<SearchKey, (SearchJob, i64)>,
    vectors: BTreeMap<SearchKey, (SearchDocument, Vec<f32>)>,
}

impl MemoryProjection {
    fn queue(&mut self, document: SearchDocument) {
        self.sequence += 1;
        let job = SearchJob { id: self.sequence, document: document.clone(), attempts: 0 };
        self.jobs.insert(document.key, (job, 0));
    }

    pub(crate) fn update(&mut self, workflow: &Workflow, events: &[process_flow_application::ports::RecordedEvent]) {
        let mut remaining: Vec<_> = self.documents.keys().filter(|k| k.workflow_id == workflow.id).cloned().collect();
        for (task, record) in &workflow.state.records {
            let key = SearchKey { workflow_id: workflow.id.clone(), task_id: task.clone() };
            remaining.retain(|k| k != &key);
            let text = record.searchable_text();
            if self.documents.get(&key).is_some_and(|d| d.text == text) {
                continue;
            }
            if text.is_empty() && !self.documents.contains_key(&key) {
                continue;
            }
            self.sequence += 1;
            let document = SearchDocument { key: key.clone(), revision: self.sequence, text };
            if document.text.is_empty() {
                self.documents.remove(&key);
            } else {
                self.documents.insert(key, document.clone());
            }
            if events.iter().any(|event| matches!(&event.event, process_flow_domain::workflow::Event::RecordUpdated { task_id, .. } if task_id == task)) {
                self.queue(document);
            }
        }
        for key in remaining {
            self.delete(key);
        }
    }

    fn delete(&mut self, key: SearchKey) {
        self.documents.remove(&key);
        self.sequence += 1;
        self.queue(SearchDocument { key, revision: self.sequence, text: String::new() });
    }

    pub(crate) fn delete_workflows(&mut self, ids: &[WorkflowId]) {
        let keys: Vec<_> = self.documents.keys().filter(|k| ids.contains(&k.workflow_id)).cloned().collect();
        for key in keys {
            self.delete(key);
        }
    }
}

#[async_trait]
impl SearchSource for InMemoryStore {
    async fn current(&self, key: &SearchKey) -> RepoResult<Option<SearchDocument>> {
        Ok(self.projection.lock().expect("memory projection lock").documents.get(key).cloned())
    }
    async fn page(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        Ok(self
            .projection
            .lock()
            .expect("memory projection lock")
            .documents
            .values()
            .filter(|d| after.is_none_or(|key| &d.key > key))
            .take(limit)
            .cloned()
            .collect())
    }
    async fn enqueue(&self, document: &SearchDocument) -> RepoResult<bool> {
        let mut projection = self.projection.lock().expect("memory projection lock");
        let current = projection.documents.get(&document.key);
        if (document.text.is_empty() && current.is_some())
            || (!document.text.is_empty() && current != Some(document))
            || projection.jobs.contains_key(&document.key)
        {
            return Ok(false);
        }
        projection.queue(document.clone());
        Ok(true)
    }
}

#[async_trait]
impl SearchJobs for InMemoryStore {
    async fn pending(&self, now_ms: i64, limit: usize) -> RepoResult<Vec<SearchJob>> {
        Ok(self
            .projection
            .lock()
            .expect("memory projection lock")
            .jobs
            .values()
            .filter(|(_, due)| *due <= now_ms)
            .take(limit)
            .map(|(job, _)| job.clone())
            .collect())
    }
    async fn acknowledge(&self, job: &SearchJob) -> RepoResult<()> {
        let mut projection = self.projection.lock().expect("memory projection lock");
        if projection.jobs.get(&job.document.key).is_some_and(|(current, _)| current.id == job.id) {
            projection.jobs.remove(&job.document.key);
        }
        Ok(())
    }
    async fn retry(&self, job: &SearchJob, available_at_ms: i64) -> RepoResult<()> {
        let mut projection = self.projection.lock().expect("memory projection lock");
        if let Some((current, due)) = projection.jobs.get_mut(&job.document.key)
            && current.id == job.id
        {
            current.attempts += 1;
            *due = available_at_ms;
        }
        Ok(())
    }
}

#[async_trait]
impl VectorIndex for InMemoryStore {
    async fn upsert(&self, document: &SearchDocument, embedding: &[f32]) -> RepoResult<()> {
        self.projection
            .lock()
            .expect("memory projection lock")
            .vectors
            .insert(document.key.clone(), (document.clone(), embedding.to_vec()));
        Ok(())
    }
    async fn remove(&self, key: &SearchKey) -> RepoResult<()> {
        self.projection.lock().expect("memory projection lock").vectors.remove(key);
        Ok(())
    }
    async fn nearest(
        &self,
        query: &[f32],
        workflows: Option<&[WorkflowId]>,
        limit: usize,
    ) -> RepoResult<Vec<SearchCandidate>> {
        let projection = self.projection.lock().expect("memory projection lock");
        let mut candidates: Vec<_> = projection
            .vectors
            .values()
            .filter(|(doc, _)| workflows.is_none_or(|ids| ids.contains(&doc.key.workflow_id)))
            .map(|(document, embedding)| SearchCandidate {
                document: document.clone(),
                score: cosine(query, embedding),
            })
            .filter(|c| c.score.is_finite())
            .collect();
        candidates.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.document.key.cmp(&b.document.key)));
        candidates.truncate(limit);
        Ok(candidates)
    }
    async fn documents(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        Ok(self
            .projection
            .lock()
            .expect("memory projection lock")
            .vectors
            .values()
            .filter(|(d, _)| after.is_none_or(|key| &d.key > key))
            .take(limit)
            .map(|(doc, _)| doc.clone())
            .collect())
    }
}

fn cosine(left: &[f32], right: &[f32]) -> f64 {
    let dot: f64 = left.iter().zip(right).map(|(a, b)| f64::from(*a) * f64::from(*b)).sum();
    let norm = |values: &[f32]| values.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>().sqrt();
    let denominator = norm(left) * norm(right);
    if denominator == 0.0 { 0.0 } else { dot / denominator }
}
