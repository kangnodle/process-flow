use async_trait::async_trait;
use process_flow_application::ports::Embedder;

pub const DEFAULT_DIMENSION: usize = 256;

#[derive(Debug, Clone, Copy)]
pub struct HashingEmbedder {
    dimension: usize,
}

impl Default for HashingEmbedder {
    fn default() -> Self {
        Self::new(DEFAULT_DIMENSION)
    }
}

impl HashingEmbedder {
    pub fn new(dimension: usize) -> Self {
        assert!(dimension > 0, "임베딩 차원은 0보다 커야 합니다");
        Self { dimension }
    }

    pub fn vectorize(&self, text: &str) -> Vec<f32> {
        let mut vector = vec![0.0f32; self.dimension];
        let lower = text.to_lowercase();
        for word in lower.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()) {
            self.add(&mut vector, word.as_bytes(), 1.0);
            let chars: Vec<char> = word.chars().collect();
            for gram in chars.windows(3) {
                let gram: String = gram.iter().collect();
                self.add(&mut vector, gram.as_bytes(), 0.5);
            }
        }
        let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            vector.iter_mut().for_each(|x| *x /= norm);
        }
        vector
    }

    fn add(&self, vector: &mut [f32], token: &[u8], weight: f32) {
        let hash = fnv1a(token);
        let index = (hash % self.dimension as u64) as usize;
        let sign = if (hash >> 63) == 0 { 1.0 } else { -1.0 };
        vector[index] += sign * weight;
    }
}

fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325u64, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3))
}

#[async_trait]
impl Embedder for HashingEmbedder {
    fn dimension(&self) -> usize {
        self.dimension
    }

    async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        Ok(self.vectorize(text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cosine(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| x * y).sum()
    }

    #[test]
    fn is_deterministic_and_normalized() {
        let e = HashingEmbedder::default();
        let v = e.vectorize("사용자 인터뷰 결과");
        assert_eq!(v, e.vectorize("사용자 인터뷰 결과"));
        assert!((cosine(&v, &v) - 1.0).abs() < 1e-5);
    }

    #[test]
    fn similar_texts_score_higher() {
        let e = HashingEmbedder::default();
        let query = e.vectorize("사용자 인터뷰");
        let close = e.vectorize("사용자 인터뷰를 다섯 번 진행했다");
        let far = e.vectorize("배포 파이프라인 롤백 계획");
        assert!(cosine(&query, &close) > cosine(&query, &far));
    }

    #[test]
    fn empty_text_is_zero_vector() {
        assert!(HashingEmbedder::new(8).vectorize("  !! ").iter().all(|x| *x == 0.0));
    }
}
