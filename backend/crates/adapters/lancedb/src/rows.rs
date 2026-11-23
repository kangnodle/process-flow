use std::sync::Arc;

use arrow_array::types::Float32Type;
use arrow_array::{Array, BooleanArray, FixedSizeListArray, Float32Array, RecordBatch, StringArray, UInt64Array};
use process_flow_application::{
    RepositoryError,
    ports::RepoResult,
    search::{SearchDocument, SearchKey},
};

use crate::{backend, schema::document_schema, vectors};

pub(crate) const DOCUMENT_COLUMNS: [&str; 4] = ["workflow_id", "task_id", "revision", "text"];

pub(crate) fn document_batch(document: &SearchDocument, vector: Vec<f32>, dimension: usize) -> RepoResult<RecordBatch> {
    let searchable = !vectors::is_zero(&vector);
    let schema = document_schema(dimension)?;
    let vector = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        [Some(vector.into_iter().map(Some).collect::<Vec<_>>())],
        dimension as i32,
    );
    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(StringArray::from(vec![document.key.workflow_id.as_str()])),
            Arc::new(StringArray::from(vec![document.key.task_id.as_str()])),
            Arc::new(UInt64Array::from(vec![document.revision])),
            Arc::new(StringArray::from(vec![document.text.as_str()])),
            Arc::new(vector),
            Arc::new(BooleanArray::from(vec![searchable])),
        ],
    )
    .map_err(backend)
}

fn column<'a, T: Array + 'static>(batch: &'a RecordBatch, name: &str, row: usize) -> RepoResult<&'a T> {
    batch
        .column_by_name(name)
        .filter(|column| !column.is_null(row))
        .and_then(|column| column.as_any().downcast_ref::<T>())
        .ok_or_else(|| RepositoryError::Corrupted(format!("Invalid LanceDB column: {name}")))
}

pub(crate) fn document_at(batch: &RecordBatch, row: usize) -> RepoResult<SearchDocument> {
    Ok(SearchDocument {
        key: SearchKey {
            workflow_id: column::<StringArray>(batch, "workflow_id", row)?.value(row).into(),
            task_id: column::<StringArray>(batch, "task_id", row)?.value(row).into(),
        },
        revision: column::<UInt64Array>(batch, "revision", row)?.value(row),
        text: column::<StringArray>(batch, "text", row)?.value(row).into(),
    })
}

pub(crate) fn distance_at(batch: &RecordBatch, row: usize) -> RepoResult<f32> {
    Ok(column::<Float32Array>(batch, "_distance", row)?.value(row))
}
