use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use process_flow_domain::ProcessId;
use process_flow_domain::process::Process;

use process_flow_application::ports::{ProcessRepository, RepoResult};

pub struct CachedProcessRepository {
    inner: Arc<dyn ProcessRepository>,
    cache: RwLock<HashMap<ProcessId, Process>>,
}

impl std::fmt::Debug for CachedProcessRepository {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CachedProcessRepository").finish_non_exhaustive()
    }
}

impl CachedProcessRepository {
    pub fn new(inner: Arc<dyn ProcessRepository>) -> Self {
        Self { inner, cache: RwLock::default() }
    }

    fn cached(&self, id: &ProcessId) -> Option<Process> {
        self.cache.read().unwrap_or_else(std::sync::PoisonError::into_inner).get(id).cloned()
    }

    fn remember(&self, process: &Process) {
        self.cache
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(process.id().clone(), process.clone());
    }
}

#[async_trait]
impl ProcessRepository for CachedProcessRepository {
    async fn find(&self, id: &ProcessId) -> RepoResult<Option<Process>> {
        if let Some(process) = self.cached(id) {
            return Ok(Some(process));
        }
        let found = self.inner.find(id).await?;
        if let Some(process) = &found {
            self.remember(process);
        }
        Ok(found)
    }

    async fn save(&self, process: &Process) -> RepoResult<()> {
        self.inner.save(process).await?;
        self.remember(process);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use process_flow_domain::process::standard::{STANDARD_PROCESS_ID, standard_process};

    use super::*;

    #[derive(Default)]
    struct Counting {
        stored: RwLock<Option<Process>>,
        finds: AtomicUsize,
    }

    #[async_trait]
    impl ProcessRepository for Counting {
        async fn find(&self, id: &ProcessId) -> RepoResult<Option<Process>> {
            self.finds.fetch_add(1, Ordering::SeqCst);
            Ok(match self.stored.read() {
                Ok(value) => value,
                Err(error) => panic!("expected read to succeed: {error:?}"),
            }
            .clone()
            .filter(|p| p.id() == id))
        }

        async fn save(&self, process: &Process) -> RepoResult<()> {
            *match self.stored.write() {
                Ok(value) => value,
                Err(error) => panic!("expected write to succeed: {error:?}"),
            } = Some(process.clone());
            Ok(())
        }
    }

    #[tokio::test]
    async fn reads_each_process_from_the_store_once() {
        let inner = Arc::new(Counting::default());
        match inner.save(&standard_process()).await {
            Ok(value) => value,
            Err(error) => panic!("expected save to succeed: {error:?}"),
        };
        let cache = CachedProcessRepository::new(inner.clone());
        let id: ProcessId = STANDARD_PROCESS_ID.into();

        assert_eq!(
            match cache.find(&id).await {
                Ok(value) => value,
                Err(error) => panic!("expected find to succeed: {error:?}"),
            },
            Some(standard_process())
        );
        assert_eq!(
            match cache.find(&id).await {
                Ok(value) => value,
                Err(error) => panic!("expected find to succeed: {error:?}"),
            },
            Some(standard_process())
        );
        assert_eq!(inner.finds.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn does_not_remember_missing_processes_and_caches_saved_ones() {
        let inner = Arc::new(Counting::default());
        let cache = CachedProcessRepository::new(inner.clone());
        let id: ProcessId = STANDARD_PROCESS_ID.into();

        assert_eq!(
            match cache.find(&id).await {
                Ok(value) => value,
                Err(error) => panic!("expected find to succeed: {error:?}"),
            },
            None
        );
        match cache.save(&standard_process()).await {
            Ok(value) => value,
            Err(error) => panic!("expected save to succeed: {error:?}"),
        };
        assert_eq!(
            match cache.find(&id).await {
                Ok(value) => value,
                Err(error) => panic!("expected find to succeed: {error:?}"),
            },
            Some(standard_process())
        );
        assert_eq!(inner.finds.load(Ordering::SeqCst), 1);
    }
}
