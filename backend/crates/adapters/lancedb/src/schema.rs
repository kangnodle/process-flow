use std::collections::HashMap;
use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema, SchemaRef};
use process_flow_application::{RepositoryError, ports::RepoResult};

pub(crate) fn document_schema(dimension: usize) -> RepoResult<SchemaRef> {
    let dimension = i32::try_from(dimension)
        .ok()
        .filter(|dimension| *dimension > 0)
        .ok_or_else(|| RepositoryError::Backend("Embedding dimension must be between 1 and i32::MAX".into()))?;
    let fields = vec![
        Field::new("workflow_id", DataType::Utf8, false),
        Field::new("task_id", DataType::Utf8, false),
        Field::new("revision", DataType::UInt64, false),
        Field::new("text", DataType::Utf8, false),
        Field::new(
            "vector",
            DataType::FixedSizeList(Arc::new(Field::new("item", DataType::Float32, true)), dimension),
            false,
        ),
        Field::new("searchable", DataType::Boolean, false),
    ];
    let metadata = HashMap::from([("embedding_version".into(), "hashing-fnv1a-v1".into())]);
    Ok(Arc::new(Schema::new_with_metadata(fields, metadata)))
}
