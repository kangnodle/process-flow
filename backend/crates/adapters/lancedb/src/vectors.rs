use process_flow_application::{RepositoryError, ports::RepoResult};

pub(crate) fn normalize(vector: &[f32], dimension: usize) -> RepoResult<Vec<f32>> {
    if vector.len() != dimension || vector.iter().any(|value| !value.is_finite()) {
        return Err(RepositoryError::Backend(
            "Embedding must have the configured dimension and finite components".into(),
        ));
    }
    let norm = vector.iter().map(|value| f64::from(*value).powi(2)).sum::<f64>().sqrt();
    if norm == 0.0 {
        return Ok(vec![0.0; dimension]);
    }
    Ok(vector.iter().map(|value| (f64::from(*value) / norm) as f32).collect())
}

pub(crate) fn is_zero(vector: &[f32]) -> bool {
    vector.iter().all(|value| *value == 0.0)
}
