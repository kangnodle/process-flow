use async_trait::async_trait;
use process_flow_application::ports::{Embedder, RepoResult};
use process_flow_application::search::{
    SearchCandidate, SearchDocument, SearchJob, SearchJobs, SearchKey, SearchSource, VectorIndex,
};
use process_flow_domain::WorkflowId;
use process_flow_runtime::indexing::{repair_search_index, sync_search_jobs};
use process_flow_testing::{FixedClock, LetterEmbedder};
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Default)]
struct State {
    source: BTreeMap<SearchKey, SearchDocument>,
    vectors: BTreeMap<SearchKey, SearchDocument>,
    jobs: Vec<SearchJob>,
    acknowledged: Vec<u64>,
    retried: Vec<(u64, i64)>,
    fail_key: Option<SearchKey>,
}
#[derive(Default)]
struct Projection(Mutex<State>);
fn document(task: &str, revision: u64, text: &str) -> SearchDocument {
    SearchDocument { key: SearchKey { workflow_id: "w".into(), task_id: task.into() }, revision, text: text.into() }
}
#[async_trait]
impl SearchSource for Projection {
    async fn current(&self, key: &SearchKey) -> RepoResult<Option<SearchDocument>> {
        Ok(self.0.lock().unwrap().source.get(key).cloned())
    }
    async fn page(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .source
            .values()
            .filter(|d| after.is_none_or(|k| &d.key > k))
            .take(limit)
            .cloned()
            .collect())
    }
    async fn enqueue(&self, doc: &SearchDocument) -> RepoResult<bool> {
        let mut state = self.0.lock().unwrap();
        let current = state.source.get(&doc.key);
        if (doc.text.is_empty() && current.is_some()) || (!doc.text.is_empty() && current != Some(doc)) {
            return Ok(false);
        }
        if state.jobs.iter().any(|j| j.document.key == doc.key) {
            return Ok(false);
        }
        state.jobs.push(SearchJob { id: doc.revision, document: doc.clone(), attempts: 0 });
        Ok(true)
    }
}
#[async_trait]
impl SearchJobs for Projection {
    async fn pending(&self, _: i64, limit: usize) -> RepoResult<Vec<SearchJob>> {
        Ok(self.0.lock().unwrap().jobs.iter().take(limit).cloned().collect())
    }
    async fn acknowledge(&self, job: &SearchJob) -> RepoResult<()> {
        let mut state = self.0.lock().unwrap();
        state.acknowledged.push(job.id);
        state.jobs.retain(|j| j.id != job.id);
        Ok(())
    }
    async fn retry(&self, job: &SearchJob, due: i64) -> RepoResult<()> {
        self.0.lock().unwrap().retried.push((job.id, due));
        Ok(())
    }
}
#[async_trait]
impl VectorIndex for Projection {
    async fn upsert(&self, doc: &SearchDocument, _: &[f32]) -> RepoResult<()> {
        let mut state = self.0.lock().unwrap();
        if state.fail_key.as_ref() == Some(&doc.key) {
            return Err(process_flow_application::RepositoryError::Backend("injected unavailable index".into()));
        }
        state.vectors.insert(doc.key.clone(), doc.clone());
        Ok(())
    }
    async fn remove(&self, key: &SearchKey) -> RepoResult<()> {
        self.0.lock().unwrap().vectors.remove(key);
        Ok(())
    }
    async fn nearest(&self, _: &[f32], _: Option<&[WorkflowId]>, _: usize) -> RepoResult<Vec<SearchCandidate>> {
        Ok(Vec::new())
    }
    async fn documents(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .vectors
            .values()
            .filter(|d| after.is_none_or(|k| &d.key > k))
            .take(limit)
            .cloned()
            .collect())
    }
}
#[tokio::test]
async fn failed_document_retries_without_blocking_other_jobs() {
    let projection = Projection::default();
    let first = document("a", 1, "first");
    let second = document("b", 2, "second");
    {
        let mut state = projection.0.lock().unwrap();
        for doc in [&first, &second] {
            state.source.insert(doc.key.clone(), doc.clone());
            state.jobs.push(SearchJob { id: doc.revision, document: doc.clone(), attempts: 2 });
        }
        state.fail_key = Some(first.key.clone());
    }
    let report =
        sync_search_jobs(&projection, &projection, &projection, &LetterEmbedder, &FixedClock::default()).await.unwrap();
    assert_eq!(report.completed, 1);
    assert_eq!(report.failures.len(), 1);
    let state = projection.0.lock().unwrap();
    assert_eq!(state.acknowledged, vec![2]);
    assert_eq!(state.retried, vec![(1, process_flow_testing::FIXED_NOW_MS + 4_000)]);
    assert_eq!(state.vectors.get(&second.key), Some(&second));
}
#[tokio::test]
async fn stale_job_never_replaces_latest_source() {
    let projection = Projection::default();
    let old = document("a", 1, "old");
    let latest = document("a", 2, "latest");
    {
        let mut state = projection.0.lock().unwrap();
        state.source.insert(latest.key.clone(), latest);
        state.jobs.push(SearchJob { id: 1, document: old, attempts: 0 });
    }
    sync_search_jobs(&projection, &projection, &projection, &LetterEmbedder, &FixedClock::default()).await.unwrap();
    assert!(projection.0.lock().unwrap().vectors.is_empty());
}
#[tokio::test]
async fn repair_finds_missing_changed_and_orphaned_documents_across_pages() {
    let projection = Projection::default();
    {
        let mut state = projection.0.lock().unwrap();
        for n in 0..70 {
            let doc = document(&format!("task{n:03}"), n + 1, "current");
            state.source.insert(doc.key.clone(), doc);
        }
        let old = document("task000", 1, "old");
        state.vectors.insert(old.key.clone(), old);
        let orphan = document("z-orphan", 999, "deleted");
        state.vectors.insert(orphan.key.clone(), orphan);
    }
    let report = repair_search_index(&projection, &projection).await.unwrap();
    assert_eq!(report.enqueued, 71);
    assert!(report.failures.is_empty());
    assert_eq!(projection.0.lock().unwrap().jobs.last().unwrap().document.text, "");
    for _ in 0..3 {
        sync_search_jobs(&projection, &projection, &projection, &LetterEmbedder, &FixedClock::default()).await.unwrap();
    }
    assert_eq!(repair_search_index(&projection, &projection).await.unwrap().enqueued, 0);
    assert_eq!(projection.0.lock().unwrap().vectors.len(), 70);
}
#[tokio::test]
async fn committed_vector_without_acknowledgement_can_replay() {
    let projection = Projection::default();
    let doc = document("a", 7, "current");
    {
        let mut state = projection.0.lock().unwrap();
        state.source.insert(doc.key.clone(), doc.clone());
        state.jobs.push(SearchJob { id: 7, document: doc.clone(), attempts: 0 });
    }
    VectorIndex::upsert(&projection, &doc, &LetterEmbedder.embed("current").await.unwrap()).await.unwrap();
    sync_search_jobs(&projection, &projection, &projection, &LetterEmbedder, &FixedClock::default()).await.unwrap();
    let state = projection.0.lock().unwrap();
    assert_eq!(state.vectors.len(), 1);
    assert_eq!(state.acknowledged, vec![7]);
}
