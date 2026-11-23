use argon2::password_hash::SaltString;
use argon2::{Argon2, PasswordHash, PasswordHasher as _, PasswordVerifier as _};
use async_trait::async_trait;
use process_flow_application::ports::{PasswordHasher, TokenGenerator};
use sha2::{Digest, Sha256};

#[derive(Debug, Default, Clone, Copy)]
pub struct Argon2Hasher;

fn hash_blocking(password: &str) -> Result<String, String> {
    let salt = SaltString::encode_b64(uuid::Uuid::new_v4().as_bytes()).map_err(|e| e.to_string())?;
    Argon2::default().hash_password(password.as_bytes(), &salt).map(|hash| hash.to_string()).map_err(|e| e.to_string())
}

fn verify_blocking(password: &str, hash: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash).map_err(|e| format!("비밀번호 해시를 읽을 수 없습니다: {e}"))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::Password) => Ok(false),
        Err(other) => Err(other.to_string()),
    }
}

#[async_trait]
impl PasswordHasher for Argon2Hasher {
    async fn hash(&self, password: &str) -> Result<String, String> {
        let password = password.to_owned();
        tokio::task::spawn_blocking(move || hash_blocking(&password)).await.map_err(|e| e.to_string())?
    }

    async fn verify(&self, password: &str, hash: &str) -> Result<bool, String> {
        let (password, hash) = (password.to_owned(), hash.to_owned());
        tokio::task::spawn_blocking(move || verify_blocking(&password, &hash)).await.map_err(|e| e.to_string())?
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct RandomTokens;

impl TokenGenerator for RandomTokens {
    fn generate(&self) -> String {
        format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
    }

    fn digest(&self, token: &str) -> String {
        Sha256::digest(token.as_bytes()).iter().map(|byte| format!("{byte:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn passwords_are_salted_and_verified() {
        let hasher = Argon2Hasher;
        let first = match hasher.hash("password1").await {
            Ok(value) => value,
            Err(error) => panic!("expected hash to succeed: {error:?}"),
        };
        let second = match hasher.hash("password1").await {
            Ok(value) => value,
            Err(error) => panic!("expected hash to succeed: {error:?}"),
        };
        assert!(first.starts_with("$argon2id$"), "{first}");
        assert_ne!(first, second);
        assert_eq!(hasher.verify("password1", &first).await, Ok(true));
        assert_eq!(hasher.verify("password2", &first).await, Ok(false));
        assert!(hasher.verify("password1", "not-a-hash").await.is_err());
    }

    #[test]
    fn tokens_are_unique_and_digested() {
        let tokens = RandomTokens;
        let (a, b) = (tokens.generate(), tokens.generate());
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert_eq!(tokens.digest(&a), tokens.digest(&a));
        assert_ne!(tokens.digest(&a), tokens.digest(&b));
        assert_eq!(tokens.digest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
