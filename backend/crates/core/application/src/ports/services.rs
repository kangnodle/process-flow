use async_trait::async_trait;

#[async_trait]
pub trait Embedder: Send + Sync {
    fn dimension(&self) -> usize;
    async fn embed(&self, text: &str) -> Result<Vec<f32>, String>;
}

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub trait IdGenerator: Send + Sync {
    fn next_id(&self) -> String;
}
