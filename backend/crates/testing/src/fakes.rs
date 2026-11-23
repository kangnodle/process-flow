use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};

use async_trait::async_trait;
use process_flow_application::ports::{Clock, Embedder, IdGenerator, PasswordHasher, TokenGenerator};
use process_flow_domain::user::Actor;

#[derive(Debug, Default)]
pub struct LetterEmbedder;

#[async_trait]
impl Embedder for LetterEmbedder {
    fn dimension(&self) -> usize {
        26
    }

    async fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut vector = vec![0.0; 26];
        for c in text.to_ascii_lowercase().bytes().filter(u8::is_ascii_lowercase) {
            vector[usize::from(c - b'a')] += 1.0;
        }
        Ok(vector)
    }
}

#[derive(Debug)]
pub struct FixedClock(AtomicI64);

pub const FIXED_NOW_MS: i64 = 1_700_000_000_000;

impl Default for FixedClock {
    fn default() -> Self {
        Self(AtomicI64::new(FIXED_NOW_MS))
    }
}

impl FixedClock {
    pub fn advance(&self, ms: i64) {
        self.0.fetch_add(ms, Ordering::Relaxed);
    }
}

impl Clock for FixedClock {
    fn now_ms(&self) -> i64 {
        self.0.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Default)]
pub struct PlainHasher;

#[async_trait]
impl PasswordHasher for PlainHasher {
    async fn hash(&self, password: &str) -> Result<String, String> {
        Ok(format!("plain:{password}"))
    }

    async fn verify(&self, password: &str, hash: &str) -> Result<bool, String> {
        Ok(hash.strip_prefix("plain:") == Some(password))
    }
}

#[derive(Debug, Default)]
pub struct SequentialTokens(AtomicU64);

impl TokenGenerator for SequentialTokens {
    fn generate(&self) -> String {
        format!("token{}", self.0.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn digest(&self, token: &str) -> String {
        format!("digest:{token}")
    }
}

pub fn admin_actor() -> Actor {
    Actor { user_id: "admin".into(), is_admin: true }
}

#[derive(Debug, Default)]
pub struct SequentialIds(AtomicU64);

impl IdGenerator for SequentialIds {
    fn next_id(&self) -> String {
        format!("id{}", self.0.fetch_add(1, Ordering::Relaxed) + 1)
    }
}
