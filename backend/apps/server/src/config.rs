use std::fmt;

use process_flow_adapter_embedding::DEFAULT_DIMENSION;
use process_flow_adapter_sqlite::SqliteConfig;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub workers: Option<usize>,
    pub allowed_origins: Vec<String>,
    pub sqlite: SqliteConfig,
    pub lancedb_uri: String,
    pub embedding_dimension: usize,
    pub cookie_secure: bool,
    pub session_ttl_hours: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ConfigError {
    pub key: &'static str,
    pub message: String,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "환경 변수 {}: {}", self.key, self.message)
    }
}

impl std::error::Error for ConfigError {}

impl AppConfig {
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let get =
            |key: &str, default: &str| lookup(key).filter(|v| !v.trim().is_empty()).unwrap_or_else(|| default.into());

        let port = parse::<u16>("APP_PORT", &get("APP_PORT", "8080"))?;
        let workers =
            lookup("APP_WORKERS").filter(|v| !v.is_empty()).map(|v| parse::<usize>("APP_WORKERS", &v)).transpose()?;
        let embedding_dimension =
            parse::<usize>("EMBEDDING_DIMENSION", &get("EMBEDDING_DIMENSION", &DEFAULT_DIMENSION.to_string()))?;
        if embedding_dimension == 0 {
            return Err(ConfigError { key: "EMBEDDING_DIMENSION", message: "0보다 커야 합니다".into() });
        }

        let cookie_secure = match get("COOKIE_SECURE", "false").trim().to_ascii_lowercase().as_str() {
            "true" | "1" => true,
            "false" | "0" => false,
            other => {
                return Err(ConfigError {
                    key: "COOKIE_SECURE",
                    message: format!("true 또는 false여야 합니다: '{other}'"),
                });
            }
        };
        let session_ttl_hours = parse::<u32>("SESSION_TTL_HOURS", &get("SESSION_TTL_HOURS", "168"))?;
        if session_ttl_hours == 0 {
            return Err(ConfigError { key: "SESSION_TTL_HOURS", message: "0보다 커야 합니다".into() });
        }

        Ok(Self {
            host: get("APP_HOST", "127.0.0.1"),
            port,
            workers,
            allowed_origins: get("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
                .split(',')
                .map(|o| o.trim().to_owned())
                .filter(|o| !o.is_empty())
                .collect(),
            sqlite: SqliteConfig { url: get("SQLITE_URL", "sqlite://data/process-flow.sqlite3") },
            lancedb_uri: get("LANCEDB_URI", "data/search.lancedb"),
            embedding_dimension,
            cookie_secure,
            session_ttl_hours,
        })
    }
}

fn parse<T: std::str::FromStr>(key: &'static str, value: &str) -> Result<T, ConfigError>
where
    T::Err: fmt::Display,
{
    value
        .trim()
        .parse()
        .map_err(|e: T::Err| ConfigError { key, message: format!("'{value}'을(를) 읽을 수 없습니다: {e}") })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config(pairs: &[(&str, &str)]) -> Result<AppConfig, ConfigError> {
        let env: HashMap<String, String> = pairs.iter().map(|(k, v)| ((*k).into(), (*v).into())).collect();
        AppConfig::from_lookup(|key| env.get(key).cloned())
    }

    #[test]
    fn defaults_to_sqlite_and_lancedb() {
        let c = match config(&[]) {
            Ok(value) => value,
            Err(error) => panic!("expected config to succeed: {error:?}"),
        };
        assert_eq!((c.host.as_str(), c.port), ("127.0.0.1", 8080));
        assert_eq!(c.sqlite.url, "sqlite://data/process-flow.sqlite3");
        assert_eq!(c.allowed_origins, vec!["http://localhost:5173"]);
        assert_eq!(c.lancedb_uri, "data/search.lancedb");
        assert_eq!((c.cookie_secure, c.session_ttl_hours), (false, 168));
    }

    #[test]
    fn reads_overrides() {
        let c = match config(&[
            ("APP_PORT", "9000"),
            ("SQLITE_URL", "sqlite::memory:"),
            ("LANCEDB_URI", "data/test-search.lancedb"),
            ("CORS_ALLOWED_ORIGINS", "http://a.test, http://b.test"),
            ("COOKIE_SECURE", "TRUE"),
            ("SESSION_TTL_HOURS", "12"),
        ]) {
            Ok(value) => value,
            Err(error) => panic!("expected config to succeed: {error:?}"),
        };
        assert_eq!(c.port, 9000);
        assert_eq!(c.sqlite.url, "sqlite::memory:");
        assert_eq!(c.lancedb_uri, "data/test-search.lancedb");
        assert_eq!(c.allowed_origins.len(), 2);
        assert_eq!((c.cookie_secure, c.session_ttl_hours), (true, 12));
    }

    #[test]
    fn rejects_bad_values() {
        assert_eq!(config(&[("APP_PORT", "x")]).unwrap_err().key, "APP_PORT");
        assert_eq!(config(&[("EMBEDDING_DIMENSION", "0")]).unwrap_err().key, "EMBEDDING_DIMENSION");
        assert_eq!(config(&[("COOKIE_SECURE", "yes")]).unwrap_err().key, "COOKIE_SECURE");
        assert_eq!(config(&[("SESSION_TTL_HOURS", "0")]).unwrap_err().key, "SESSION_TTL_HOURS");
    }
}
