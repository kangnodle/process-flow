mod rows;
mod schema;
mod vectors;

use std::path::{Path, PathBuf};

use async_trait::async_trait;
use futures_util::TryStreamExt;
use lancedb::expr::{col, lit};
use lancedb::query::{ColumnOrdering, ExecutableQuery, QueryBase, Select};
use lancedb::{DistanceType, Table};
use process_flow_application::{
    RepositoryError,
    ports::RepoResult,
    search::{SearchCandidate, SearchDocument, SearchKey, VectorIndex},
};
use process_flow_domain::WorkflowId;
use tokio::sync::Mutex;

use rows::{DOCUMENT_COLUMNS, document_at};

const TABLE_NAME: &str = "search_documents";

#[derive(Debug)]
pub struct LanceConfig {
    pub uri: String,
    pub dimension: usize,
}

impl LanceConfig {
    pub fn table_path(&self) -> PathBuf {
        Path::new(&self.uri).join(format!("{TABLE_NAME}.lance"))
    }
}

#[derive(Debug)]
pub struct LanceRecordIndex {
    table: Table,
    dimension: usize,
    writes: Mutex<()>,
}

impl LanceRecordIndex {
    pub async fn connect(config: &LanceConfig) -> RepoResult<Self> {
        let expected = schema::document_schema(config.dimension)?;
        let database = lancedb::connect(&config.uri).execute().await.map_err(backend)?;
        let table = match database.open_table(TABLE_NAME).execute().await {
            Ok(table) => table,
            Err(lancedb::Error::TableNotFound { .. }) => {
                database.create_empty_table(TABLE_NAME, expected.clone()).execute().await.map_err(backend)?
            }
            Err(error) => return Err(backend(error)),
        };
        let actual = table.schema().await.map_err(backend)?;
        if actual.fields() != expected.fields()
            || actual.metadata().get("embedding_version") != expected.metadata().get("embedding_version")
        {
            return Err(RepositoryError::Corrupted(
                "LanceDB schema or embedding version differs; rebuild the search index with --rebuild-search".into(),
            ));
        }
        Ok(Self { table, dimension: config.dimension, writes: Mutex::new(()) })
    }
}

#[async_trait]
impl VectorIndex for LanceRecordIndex {
    async fn upsert(&self, document: &SearchDocument, embedding: &[f32]) -> RepoResult<()> {
        let vector = vectors::normalize(embedding, self.dimension)?;
        let batch = rows::document_batch(document, vector, self.dimension)?;
        let reader = arrow_array::RecordBatchIterator::new(vec![Ok(batch.clone())], batch.schema());
        let _guard = self.writes.lock().await;
        let mut merge = self.table.merge_insert(&["workflow_id", "task_id"]);
        merge.when_matched_update_all(None).when_not_matched_insert_all();
        merge.execute(Box::new(reader)).await.map_err(backend)?;
        Ok(())
    }

    async fn remove(&self, key: &SearchKey) -> RepoResult<()> {
        let predicate =
            col("workflow_id").eq(lit(key.workflow_id.as_str())).and(col("task_id").eq(lit(key.task_id.as_str())));
        let _guard = self.writes.lock().await;
        self.table.delete(&predicate).await.map_err(backend)?;
        Ok(())
    }

    async fn nearest(
        &self,
        query: &[f32],
        workflows: Option<&[WorkflowId]>,
        limit: usize,
    ) -> RepoResult<Vec<SearchCandidate>> {
        let query = vectors::normalize(query, self.dimension)?;
        if limit == 0 || workflows.is_some_and(<[WorkflowId]>::is_empty) || vectors::is_zero(&query) {
            return Ok(Vec::new());
        }
        let mut search = self
            .table
            .vector_search(query)
            .map_err(backend)?
            .distance_type(DistanceType::Cosine)
            .bypass_vector_index()
            .only_if_expr(col("searchable").eq(lit(true)))
            .limit(limit);
        if let Some(workflows) = workflows {
            let allowed = workflows.iter().map(|id| lit(id.as_str())).collect();
            search = search.only_if_expr(col("workflow_id").in_list(allowed, false));
        }
        let mut stream = search.execute().await.map_err(backend)?;
        let mut candidates = Vec::new();
        while let Some(batch) = stream.try_next().await.map_err(backend)? {
            for row in 0..batch.num_rows() {
                let score = 1.0 - f64::from(rows::distance_at(&batch, row)?);
                if score.is_finite() && score > 0.0 {
                    candidates.push(SearchCandidate { document: document_at(&batch, row)?, score: score.min(1.0) });
                }
            }
        }
        candidates.sort_by(|left, right| {
            right.score.total_cmp(&left.score).then_with(|| left.document.key.cmp(&right.document.key))
        });
        Ok(candidates)
    }

    async fn documents(&self, after: Option<&SearchKey>, limit: usize) -> RepoResult<Vec<SearchDocument>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let mut query = self
            .table
            .query()
            .select(Select::columns(&DOCUMENT_COLUMNS))
            .order_by(Some(vec![
                ColumnOrdering::asc_nulls_last("workflow_id".into()),
                ColumnOrdering::asc_nulls_last("task_id".into()),
            ]))
            .limit(limit);
        if let Some(key) = after {
            query = query.only_if_expr(col("workflow_id").gt(lit(key.workflow_id.as_str())).or(
                col("workflow_id").eq(lit(key.workflow_id.as_str())).and(col("task_id").gt(lit(key.task_id.as_str()))),
            ));
        }
        let mut stream = query.execute().await.map_err(backend)?;
        let mut documents = Vec::new();
        while let Some(batch) = stream.try_next().await.map_err(backend)? {
            for row in 0..batch.num_rows() {
                documents.push(document_at(&batch, row)?);
            }
        }
        Ok(documents)
    }
}

fn backend(error: impl std::fmt::Display) -> RepositoryError {
    RepositoryError::Backend(error.to_string())
}
