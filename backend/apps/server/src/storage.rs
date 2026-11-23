use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use process_flow_adapter_embedding::HashingEmbedder;
use process_flow_adapter_lancedb::{LanceConfig, LanceRecordIndex};
use process_flow_adapter_sqlite::{SqliteSearchStore, connect};
use process_flow_adapter_system::{StorageLocks, UuidGenerator};
use process_flow_application::ports::{Clock, Embedder, IdGenerator};
use process_flow_application::search::{SearchSource, VectorIndex};
use process_flow_runtime::indexing::{repair_search_index, sync_search_jobs};
use sqlx::SqlitePool;
use sqlx::sqlite::SqliteConnectOptions;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::config::AppConfig;
use crate::wiring::BoxError;

pub struct Storage {
    pub pool: SqlitePool,
    _locks: StorageLocks,
}

impl Storage {
    pub async fn open(config: &AppConfig) -> Result<Self, BoxError> {
        if config.lancedb_uri.contains("://") {
            return Err("LANCEDB_URI must be a local directory path".into());
        }
        let options = SqliteConnectOptions::from_str(&config.sqlite.url)?;
        let filename = options.get_filename();
        let sqlite_path = (!config.sqlite.is_in_memory()).then_some(filename);
        let locks = StorageLocks::acquire(sqlite_path, Path::new(&config.lancedb_uri))?;
        let pool = connect(&config.sqlite).await?;
        Ok(Self { pool, _locks: locks })
    }
}

pub struct SearchWorker {
    stop: watch::Sender<bool>,
    handle: JoinHandle<()>,
    storage: Arc<Storage>,
}

impl SearchWorker {
    pub fn start(
        storage: Storage,
        source: Arc<SqliteSearchStore>,
        index: Arc<dyn VectorIndex>,
        embedder: Arc<dyn Embedder>,
        clock: Arc<dyn Clock>,
    ) -> Self {
        let storage = Arc::new(storage);
        let worker_storage = storage.clone();
        let (stop, mut stopping) = watch::channel(false);
        let handle = tokio::spawn(async move {
            let _storage = worker_storage;
            let mut repair_at = tokio::time::Instant::now();
            loop {
                if *stopping.borrow() {
                    break;
                }
                if tokio::time::Instant::now() >= repair_at {
                    match repair_search_index(source.as_ref(), index.as_ref()).await {
                        Ok(report) => {
                            if report.enqueued > 0 {
                                tracing::info!(
                                    enqueued = report.enqueued,
                                    scanned = report.scanned,
                                    "검색 색인 복구 작업 등록"
                                );
                            }
                            for (key, error) in report.failures {
                                tracing::warn!(workflow = %key.workflow_id, task = %key.task_id, %error, "검색 색인 복구 등록 실패");
                            }
                            repair_at = tokio::time::Instant::now() + Duration::from_secs(300);
                        }
                        Err(error) => {
                            tracing::warn!(%error, "검색 색인 복구 순회 실패");
                            repair_at = tokio::time::Instant::now() + Duration::from_secs(5);
                        }
                    }
                }
                match sync_search_jobs(
                    source.as_ref(),
                    source.as_ref(),
                    index.as_ref(),
                    embedder.as_ref(),
                    clock.as_ref(),
                )
                .await
                {
                    Ok(report) => {
                        for (key, error) in report.failures {
                            tracing::warn!(workflow = %key.workflow_id, task = %key.task_id, %error, "검색 색인 작업 실패, 재시도 예약");
                        }
                    }
                    Err(error) => tracing::warn!(%error, "검색 작업 큐 조회 실패"),
                }
                tokio::select! {
                    changed = stopping.changed() => {
                        if changed.is_err() || *stopping.borrow() { break; }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {}
                }
            }
        });
        Self { stop, handle, storage }
    }

    pub async fn shutdown(self) -> Result<(), BoxError> {
        let _ = self.stop.send(true);
        let result = self.handle.await;
        self.storage.pool.close().await;
        result?;
        Ok(())
    }
}

pub async fn rebuild_search(config: &AppConfig, storage: Storage) -> Result<(), BoxError> {
    let source = SqliteSearchStore::new(storage.pool.clone());
    let root = Path::new(&config.lancedb_uri).canonicalize()?;
    let original = LanceConfig { uri: root.to_string_lossy().into_owned(), dimension: config.embedding_dimension };
    let temporary = LanceConfig {
        uri: root.join(format!(".rebuild-{}", UuidGenerator.next_id())).to_string_lossy().into_owned(),
        dimension: config.embedding_dimension,
    };
    let original_table = original.table_path();
    if !config.sqlite.is_in_memory() {
        let source_path = storage.pool.connect_options().get_filename().canonicalize()?;
        let table_path =
            if original_table.try_exists()? { original_table.canonicalize()? } else { original_table.clone() };
        if source_path.starts_with(table_path) {
            return Err("SQLite database must be outside the LanceDB table directory before rebuilding search".into());
        }
    }
    let previous = sibling(&original_table, "previous")?;
    let index = LanceRecordIndex::connect(&temporary).await?;
    let embedder = HashingEmbedder::new(config.embedding_dimension);
    let mut after = None;
    let mut count = 0;
    loop {
        let documents = source.page(after.as_ref(), 32).await?;
        if documents.is_empty() {
            break;
        }
        after = documents.last().map(|d| d.key.clone());
        for document in documents {
            let vector = embedder.embed(&document.text).await.map_err(std::io::Error::other)?;
            index.upsert(&document, &vector).await?;
            count += 1;
        }
    }
    let mut after = None;
    let mut verified = 0;
    loop {
        let documents = index.documents(after.as_ref(), 32).await?;
        if documents.is_empty() {
            break;
        }
        after = documents.last().map(|d| d.key.clone());
        for document in documents {
            if source.current(&document.key).await?.as_ref() != Some(&document) {
                return Err("rebuilt search document differs from SQLite origin".into());
            }
            verified += 1;
        }
    }
    if verified != count {
        return Err("rebuilt search document count differs from SQLite origin".into());
    }
    drop(index);
    let had_previous = original_table.try_exists()?;
    if had_previous {
        std::fs::rename(&original_table, &previous)?;
    }
    if let Err(error) = std::fs::rename(temporary.table_path(), &original_table) {
        if had_previous {
            std::fs::rename(&previous, &original_table).map_err(|rollback| {
                std::io::Error::other(format!("index swap failed: {error}; rollback failed: {rollback}"))
            })?;
        }
        return Err(error.into());
    }
    std::fs::remove_dir_all(&temporary.uri)?;
    storage.pool.close().await;
    tracing::info!(documents = count, previous = %previous.display(), "검색 색인 재구축 완료");
    Ok(())
}

fn sibling(path: &Path, purpose: &str) -> Result<PathBuf, BoxError> {
    let mut name = path.file_name().ok_or("search path requires a directory name")?.to_os_string();
    name.push(format!(".{purpose}-{}", UuidGenerator.next_id()));
    Ok(path.with_file_name(name))
}
