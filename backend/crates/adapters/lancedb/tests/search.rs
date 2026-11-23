use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema};
use process_flow_adapter_lancedb::{LanceConfig, LanceRecordIndex};
use process_flow_application::{
    RepositoryError,
    search::{SearchDocument, SearchKey, VectorIndex},
};
use process_flow_domain::WorkflowId;
use tempfile::TempDir;

fn config(directory: &TempDir) -> LanceConfig {
    LanceConfig { uri: directory.path().to_str().unwrap().to_owned(), dimension: 2 }
}

async fn open_index() -> (TempDir, LanceRecordIndex) {
    let directory = tempfile::tempdir().unwrap();
    let index = LanceRecordIndex::connect(&config(&directory)).await.unwrap();
    (directory, index)
}

fn document(workflow_id: &str, task_id: &str, revision: u64, text: &str) -> SearchDocument {
    SearchDocument {
        key: SearchKey { workflow_id: workflow_id.into(), task_id: task_id.into() },
        revision,
        text: text.into(),
    }
}

#[tokio::test]
async fn returns_positive_cosine_scores_in_descending_order() {
    let (_directory, index) = open_index().await;
    let perfect = document("a", "perfect", 1, "same direction");
    let diagonal = document("a", "diagonal", 2, "partial similarity");
    index.upsert(&diagonal, &[2.0, 2.0]).await.unwrap();
    index.upsert(&document("a", "negative", 3, "opposite"), &[-1.0, 0.0]).await.unwrap();
    index.upsert(&document("a", "orthogonal", 4, "unrelated"), &[0.0, 1.0]).await.unwrap();
    index.upsert(&perfect, &[3.0, 0.0]).await.unwrap();

    let results = index.nearest(&[1.0, 0.0], None, 10).await.unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].document, perfect);
    assert!((results[0].score - 1.0).abs() < 1e-6);
    assert_eq!(results[1].document, diagonal);
    assert!((results[1].score - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    assert_eq!(index.nearest(&[1.0, 0.0], None, 1).await.unwrap(), results[..1]);
}

#[tokio::test]
async fn applies_workflow_scope_before_limiting_candidates() {
    let (_directory, index) = open_index().await;
    let allowed = document("allowed", "same-task", 1, "allowed");
    index.upsert(&allowed, &[1.0, 1.0]).await.unwrap();
    index.upsert(&document("other", "same-task", 2, "hidden"), &[1.0, 0.0]).await.unwrap();

    let workflows = [WorkflowId::new("allowed"), WorkflowId::new("missing")];
    let results = index.nearest(&[1.0, 0.0], Some(&workflows), 1).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].document, allowed);
    assert!(index.nearest(&[1.0, 0.0], Some(&[]), 10).await.unwrap().is_empty());
    assert!(index.nearest(&[1.0, 0.0], None, 0).await.unwrap().is_empty());
}

#[tokio::test]
async fn repeated_writes_preserve_a_single_row_per_composite_key() {
    let (_directory, index) = open_index().await;
    let old = document("a", "t", 1, "old");
    let new = document("a", "t", u64::MAX, "new");
    let other = document("b", "t", 2, "other");
    index.upsert(&old, &[0.0, 1.0]).await.unwrap();
    index.upsert(&other, &[1.0, 0.0]).await.unwrap();
    let (first, second) = tokio::join!(index.upsert(&new, &[1.0, 0.0]), index.upsert(&new, &[1.0, 0.0]));
    first.unwrap();
    second.unwrap();
    assert_eq!(index.documents(None, 10).await.unwrap(), vec![new.clone(), other.clone()]);

    index.remove(&new.key).await.unwrap();
    index.remove(&new.key).await.unwrap();
    assert_eq!(index.documents(None, 10).await.unwrap(), vec![other]);
}

#[tokio::test]
async fn finds_persisted_documents_after_reopening() {
    let (directory, index) = open_index().await;
    let expected = document("workflow", "task", 42, "persisted");
    index.upsert(&expected, &[1.0, 0.0]).await.unwrap();
    drop(index);

    let reopened = LanceRecordIndex::connect(&config(&directory)).await.unwrap();
    let results = reopened.nearest(&[1.0, 0.0], None, 5).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].document, expected);
}

#[tokio::test]
async fn pages_by_workflow_and_task_with_an_exclusive_cursor() {
    let (_directory, index) = open_index().await;
    let first = document("a", "a", 1, "first");
    let second = document("a", "z", 2, "second");
    let last = document("b", "a", 3, "last");
    for row in [&last, &second, &first] {
        index.upsert(row, &[1.0, 0.0]).await.unwrap();
    }

    assert_eq!(index.documents(None, 1).await.unwrap(), vec![first.clone()]);
    assert_eq!(index.documents(Some(&first.key), 2).await.unwrap(), vec![second, last.clone()]);
    assert!(index.documents(Some(&last.key), 2).await.unwrap().is_empty());
    assert!(index.documents(None, 0).await.unwrap().is_empty());
}

#[tokio::test]
async fn uses_quoted_identifiers_as_literal_values() {
    let (_directory, index) = open_index().await;
    let special = document("db') OR true -- \\ 한국", "task' OR true --", 1, "literal ID");
    let other = document("regular", "task' OR true --", 2, "unrelated");
    index.upsert(&other, &[1.0, 0.0]).await.unwrap();
    index.upsert(&special, &[1.0, 1.0]).await.unwrap();

    let results = index.nearest(&[1.0, 0.0], Some(std::slice::from_ref(&special.key.workflow_id)), 1).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].document, special);
    assert_eq!(index.documents(Some(&special.key), 1).await.unwrap(), vec![other.clone()]);
    index.remove(&special.key).await.unwrap();
    assert_eq!(index.documents(None, 10).await.unwrap(), vec![other]);
}

#[tokio::test]
async fn excludes_zero_vectors_from_similarity_but_preserves_their_documents() {
    let (_directory, index) = open_index().await;
    let zero = document("a", "zero", 1, "zero");
    let nonzero = document("a", "nonzero", 2, "nonzero");
    index.upsert(&zero, &[0.0, -0.0]).await.unwrap();
    index.upsert(&nonzero, &[1.0, 0.0]).await.unwrap();

    assert!(index.nearest(&[0.0, 0.0], None, 10).await.unwrap().is_empty());
    let results = index.nearest(&[1.0, 0.0], None, 10).await.unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].document, nonzero);
    assert_eq!(index.documents(None, 10).await.unwrap(), vec![nonzero, zero]);
}

#[tokio::test]
async fn rejects_invalid_embeddings_and_queries() {
    let (_directory, index) = open_index().await;
    let row = document("a", "t", 1, "text");

    for invalid in [&[1.0][..], &[f32::INFINITY, 0.0], &[0.0, f32::NAN]] {
        assert!(index.upsert(&row, invalid).await.is_err());
        assert!(index.nearest(invalid, None, 1).await.is_err());
    }
    assert!(index.documents(None, 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn ranks_finite_embeddings_with_extreme_magnitudes() {
    let (_directory, index) = open_index().await;
    let large = document("a", "large", 1, "large");
    let small = document("a", "small", 2, "small");
    index.upsert(&large, &[f32::MAX, f32::MAX]).await.unwrap();
    index.upsert(&small, &[f32::from_bits(1), 0.0]).await.unwrap();

    let results = index.nearest(&[f32::MAX, 0.0], None, 10).await.unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].document, small);
    assert!((results[0].score - 1.0).abs() < 1e-6);
    assert_eq!(results[1].document, large);
    assert!((results[1].score - std::f64::consts::FRAC_1_SQRT_2).abs() < 1e-6);
}

#[tokio::test]
async fn rejects_a_dimension_mismatch_without_replacing_the_existing_index() {
    let (directory, index) = open_index().await;
    let original = document("a", "t", 1, "original");
    index.upsert(&original, &[1.0, 0.0]).await.unwrap();
    drop(index);

    let mut settings = config(&directory);
    settings.dimension = 3;
    assert!(matches!(LanceRecordIndex::connect(&settings).await, Err(RepositoryError::Corrupted(_))));

    let reopened = LanceRecordIndex::connect(&config(&directory)).await.unwrap();
    assert_eq!(reopened.documents(None, 10).await.unwrap(), vec![original]);
}

#[tokio::test]
async fn rejects_unsupported_dimensions_before_creating_the_index() {
    let directory = tempfile::tempdir().unwrap();
    let mut settings = config(&directory);
    let path = directory.path().join("search.lancedb");
    settings.uri = path.to_str().unwrap().to_owned();
    for invalid in [0, i32::MAX as usize + 1] {
        settings.dimension = invalid;
        assert!(LanceRecordIndex::connect(&settings).await.is_err());
    }
    assert!(!path.exists());
}

#[tokio::test]
async fn rejects_an_incompatible_existing_schema() {
    let directory = tempfile::tempdir().unwrap();
    let settings = config(&directory);
    let database = lancedb::connect(&settings.uri).execute().await.unwrap();
    let schema = Arc::new(Schema::new(vec![Field::new("workflow_id", DataType::Utf8, true)]));
    database.create_empty_table("search_documents", schema).execute().await.unwrap();

    assert!(matches!(LanceRecordIndex::connect(&settings).await, Err(RepositoryError::Corrupted(_))));
    let previous = database.open_table("search_documents").execute().await.unwrap();
    assert_eq!(previous.schema().await.unwrap().fields().len(), 1);
}

#[tokio::test]
async fn rejects_an_incompatible_embedding_version_without_overwriting_the_index() {
    let (directory, index) = open_index().await;
    drop(index);
    let settings = config(&directory);
    let database = lancedb::connect(&settings.uri).execute().await.unwrap();
    let table = database.open_table("search_documents").execute().await.unwrap();
    table
        .as_native()
        .unwrap()
        .replace_schema_metadata([("embedding_version".into(), "incompatible".into())])
        .await
        .unwrap();

    assert!(matches!(LanceRecordIndex::connect(&settings).await, Err(RepositoryError::Corrupted(_))));
    assert_eq!(table.schema().await.unwrap().metadata()["embedding_version"], "incompatible");
}
