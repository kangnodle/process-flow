use process_flow_application::ports::{Clock, Embedder, RepoResult};
use process_flow_application::search::{SearchDocument, SearchJob, SearchJobs, SearchKey, SearchSource, VectorIndex};
use std::collections::VecDeque;

const PAGE_SIZE: usize = 32;

#[derive(Debug, Default)]
pub struct SyncReport {
    pub completed: usize,
    pub failures: Vec<(SearchKey, String)>,
}

#[derive(Debug, Default)]
pub struct RepairReport {
    pub scanned: usize,
    pub enqueued: usize,
    pub failures: Vec<(SearchKey, String)>,
}

pub async fn sync_search_jobs(
    jobs: &dyn SearchJobs,
    source: &dyn SearchSource,
    index: &dyn VectorIndex,
    embedder: &dyn Embedder,
    clock: &dyn Clock,
) -> RepoResult<SyncReport> {
    let mut report = SyncReport::default();
    for job in jobs.pending(clock.now_ms(), PAGE_SIZE).await? {
        let result = apply_search_job(&job, source, index, embedder).await;
        let result = match result {
            Ok(()) => jobs.acknowledge(&job).await,
            Err(error) => Err(error),
        };
        match result {
            Ok(()) => report.completed += 1,
            Err(error) => {
                let delay = 1_000_i64 * (1_i64 << job.attempts.min(8));
                let retry = jobs.retry(&job, clock.now_ms().saturating_add(delay)).await;
                let message = match retry {
                    Ok(()) => error.to_string(),
                    Err(retry_error) => format!("{error}; retry registration failed: {retry_error}"),
                };
                report.failures.push((job.document.key, message));
            }
        }
    }
    Ok(report)
}

async fn apply_search_job(
    job: &SearchJob,
    source: &dyn SearchSource,
    index: &dyn VectorIndex,
    embedder: &dyn Embedder,
) -> RepoResult<()> {
    match source.current(&job.document.key).await? {
        Some(current) if current == job.document && !current.text.is_empty() => {
            let vector =
                embedder.embed(&current.text).await.map_err(process_flow_application::RepositoryError::Backend)?;
            index.upsert(&current, &vector).await
        }
        None => index.remove(&job.document.key).await,
        Some(_) => Ok(()),
    }
}

pub async fn repair_search_index(source: &dyn SearchSource, index: &dyn VectorIndex) -> RepoResult<RepairReport> {
    let mut report = RepairReport::default();
    let mut originals = VecDeque::new();
    let mut indexed = VecDeque::new();
    let mut source_after = None;
    let mut index_after = None;
    let mut source_done = false;
    let mut index_done = false;
    loop {
        if originals.is_empty() && !source_done {
            let page = source.page(source_after.as_ref(), PAGE_SIZE).await?;
            source_done = page.len() < PAGE_SIZE;
            source_after = page.last().map(|d| d.key.clone());
            originals.extend(page);
        }
        if indexed.is_empty() && !index_done {
            let page = index.documents(index_after.as_ref(), PAGE_SIZE).await?;
            index_done = page.len() < PAGE_SIZE;
            index_after = page.last().map(|d| d.key.clone());
            indexed.extend(page);
        }
        let candidate = match (originals.front(), indexed.front()) {
            (None, None) => break,
            (Some(original), Some(projection)) if original.key == projection.key => {
                let original = originals.pop_front().expect("source front exists");
                let projection = indexed.pop_front().expect("index front exists");
                (original != projection).then_some(original)
            }
            (Some(original), Some(projection)) if original.key < projection.key => originals.pop_front(),
            (Some(_), None) => originals.pop_front(),
            _ => indexed.pop_front().map(|document| SearchDocument { text: String::new(), ..document }),
        };
        report.scanned += 1;
        if let Some(document) = candidate {
            match source.enqueue(&document).await {
                Ok(true) => report.enqueued += 1,
                Ok(false) => {}
                Err(error) => report.failures.push((document.key, error.to_string())),
            }
        }
    }
    Ok(report)
}
