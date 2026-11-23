#![cfg(unix)]

use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

use reqwest::StatusCode;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{COOKIE, HeaderMap, HeaderValue, SET_COOKIE};
use rustix::process::{Pid, Signal, kill_process};
use serde_json::{Value, json};

const STARTUP_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_INTERVAL: Duration = Duration::from_millis(50);

struct Server(Child);

impl Server {
    fn start(directory: &Path, address: &str, client: &Client) -> Self {
        let sqlite_url = format!("sqlite://{}", directory.join("data/process-flow.sqlite3").display());
        Self::start_with_storage(directory, address, client, &sqlite_url, &directory.join("data/search.lancedb"))
    }

    fn start_with_storage(
        directory: &Path,
        address: &str,
        client: &Client,
        sqlite_url: &str,
        lance_path: &Path,
    ) -> Self {
        let child = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
            .current_dir(directory)
            .env("SQLITE_URL", sqlite_url)
            .env("LANCEDB_URI", lance_path)
            .env_remove("EMBEDDING_DIMENSION")
            .env("APP_HOST", "127.0.0.1")
            .env(
                "APP_PORT",
                match address.rsplit_once(':') {
                    Some(value) => value,
                    None => panic!("expected rsplit_once to be present"),
                }
                .1,
            )
            .env("APP_WORKERS", "1")
            .spawn()
            .expect("start backend process");
        let mut server = Self(child);
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        loop {
            assert!(
                match server.0.try_wait() {
                    Ok(value) => value,
                    Err(error) => panic!("expected try_wait to succeed: {error:?}"),
                }
                .is_none(),
                "backend exited before it was ready"
            );
            if client.get(format!("http://{address}/health")).send().is_ok_and(|r| r.status() == StatusCode::OK) {
                return server;
            }
            assert!(Instant::now() < deadline, "backend did not become ready");
            thread::sleep(POLL_INTERVAL);
        }
    }

    fn stop(mut self) {
        let pid = match Pid::from_raw(match i32::try_from(self.0.id()) {
            Ok(value) => value,
            Err(error) => panic!("expected i32::try_from to succeed: {error:?}"),
        }) {
            Some(value) => value,
            None => panic!("expected Pid::from_raw to be present"),
        };
        kill_process(pid, Signal::TERM).expect("send SIGTERM to backend");
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = match self.0.try_wait() {
                Ok(value) => value,
                Err(error) => panic!("expected try_wait to succeed: {error:?}"),
            } {
                assert!(status.success(), "backend shutdown failed: {status}");
                return;
            }
            assert!(Instant::now() < deadline, "backend did not shut down");
            thread::sleep(POLL_INTERVAL);
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}

fn response_json(request: RequestBuilder, expected_status: StatusCode) -> Value {
    let response = request.send().expect("backend HTTP response");
    let status = response.status();
    let body = response.text().expect("read backend response");
    assert_eq!(status, expected_status, "{body}");
    serde_json::from_str(&body).expect("parse backend JSON response")
}

#[test]
fn workflow_and_searchable_task_record_survive_restart_and_missing_index_is_repaired() {
    let directory = tempfile::tempdir().expect("create isolated data directory");
    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(value) => value,
        Err(error) => panic!("expected TcpListener::bind to succeed: {error:?}"),
    };
    let address = match listener.local_addr() {
        Ok(value) => value,
        Err(error) => panic!("expected local_addr to succeed: {error:?}"),
    }
    .to_string();
    drop(listener);
    let client = match Client::builder().no_proxy().timeout(Duration::from_secs(2)).build() {
        Ok(value) => value,
        Err(error) => panic!("expected build to succeed: {error:?}"),
    };
    let base = format!("http://{address}/api/v1");
    let workflows = format!("{base}/workflows");
    let name = "Restart verification";
    let note = "sqlite lance persistence verification";
    let record = json!({"note": note, "link": "https://example.com/record",
        "document": {"version": 1, "answers": {"problem": "Persistent reviewed problem"}, "reviewStatus": "pending"},
        "evidence": [{"id": "restart-file", "kind": "file", "title": "Restart file", "description": "Stored attachment", "fileName": "evidence.txt", "mediaType": "text/plain", "size": 1, "base64": "YQ=="}]
    });

    let server = Server::start(directory.path(), &address, &client);
    let closed = client.get(format!("{base}/projects")).send().expect("backend HTTP response");
    assert_eq!(closed.status(), StatusCode::UNAUTHORIZED);
    let admin = json!({"email": "admin@example.com", "name": "Admin", "password": "restart-password"});
    let setup = client.post(format!("{base}/auth/setup")).json(&admin).send().expect("backend HTTP response");
    assert_eq!(setup.status(), StatusCode::CREATED);
    let set_cookie = match setup.headers()[SET_COOKIE].to_str() {
        Ok(value) => value,
        Err(error) => panic!("expected to_str to succeed: {error:?}"),
    };
    assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("SameSite=Lax"), "{set_cookie}");
    let cookie = match set_cookie.split(';').next() {
        Some(value) => value,
        None => panic!("expected next to be present"),
    }
    .to_owned();
    let anonymous = client;
    let client = match Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .default_headers(HeaderMap::from_iter([(
            COOKIE,
            match HeaderValue::from_str(&cookie) {
                Ok(value) => value,
                Err(error) => panic!("expected HeaderValue::from_str to succeed: {error:?}"),
            },
        )]))
        .build()
    {
        Ok(value) => value,
        Err(error) => panic!("expected build to succeed: {error:?}"),
    };

    let project = response_json(
        client.post(format!("{base}/projects")).json(&json!({"name": "Restart project"})),
        StatusCode::CREATED,
    );
    let project_id = project["id"].as_str().expect("created project ID").to_owned();
    let user = response_json(
        client.post(format!("{base}/users")).json(&json!({
            "email": "restart@example.com",
            "name": "Restart user",
            "password": "restart-password",
        })),
        StatusCode::CREATED,
    );
    let user_id = user["id"].as_str().expect("created user ID").to_owned();
    response_json(
        client.put(format!("{base}/projects/{project_id}/members/{user_id}")).json(&json!({"role": "owner"})),
        StatusCode::OK,
    );
    let created = response_json(
        client.post(format!("{base}/projects/{project_id}/workflows")).json(&json!({"name": name})),
        StatusCode::CREATED,
    );
    let id = created["id"].as_str().expect("created workflow ID");
    let workflow = format!("{workflows}/{id}");
    let updated = response_json(
        client.post(format!("{workflow}/commands")).json(&json!({
            "expectedVersion": 0,
            "command": {"type": "updateRecord", "taskId": "goals", "patch": record},
        })),
        StatusCode::OK,
    );
    assert_eq!(updated["changed"], true);
    server.stop();

    let restarted = Server::start(directory.path(), &address, &client);
    let status = response_json(client.get(format!("{base}/auth/status")), StatusCode::OK);
    assert_eq!(status["setupRequired"], false);
    assert_eq!(status["user"]["email"], "admin@example.com");
    assert_eq!(status["user"]["isAdmin"], true);
    let login = json!({"email": "restart@example.com", "password": "restart-password"});
    let member = response_json(anonymous.post(format!("{base}/auth/login")).json(&login), StatusCode::OK);
    assert_eq!(member["isAdmin"], false);
    let wrong = json!({"email": "restart@example.com", "password": "wrong-password"});
    let rejected = anonymous.post(format!("{base}/auth/login")).json(&wrong).send().expect("backend HTTP response");
    assert_eq!(rejected.status(), StatusCode::UNAUTHORIZED);
    let detail = response_json(client.get(&workflow), StatusCode::OK);
    assert_eq!(detail["id"], id);
    assert_eq!(detail["name"], name);
    assert_eq!(detail["projectId"], project_id.as_str());
    let reloaded_project = response_json(client.get(format!("{base}/projects/{project_id}")), StatusCode::OK);
    assert_eq!(reloaded_project["name"], "Restart project");
    let members = response_json(client.get(format!("{base}/projects/{project_id}/members")), StatusCode::OK);
    assert_eq!(members[0]["user"]["email"], "admin@example.com");
    assert_eq!(members[1]["role"], "owner");
    assert_eq!(members[1]["user"]["email"], "restart@example.com");
    assert_eq!(reloaded_project["role"], "owner");
    assert_eq!(detail["version"], 1);
    assert_eq!(detail["records"]["goals"], record);

    let listed = response_json(client.get(&workflows), StatusCode::OK);
    assert!(
        match listed.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .iter()
        .any(|row| row["id"] == id),
        "{listed}"
    );

    let deadline = Instant::now() + Duration::from_secs(10);
    let results = loop {
        let results = response_json(
            client.get(format!("{base}/search/records")).query(&[("q", note), ("workflowId", id)]),
            StatusCode::OK,
        );
        if !match results["hits"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .is_empty()
        {
            break results;
        }
        assert!(Instant::now() < deadline, "index worker did not catch up");
        thread::sleep(POLL_INTERVAL);
    };
    assert!(
        match results["hits"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .iter()
        .any(|hit| {
            hit["workflowId"] == id
                && hit["taskId"] == "goals"
                && hit["text"].as_str().is_some_and(|text| text.contains(note))
                && hit["score"].as_f64().is_some_and(|score| score > 0.0)
        }),
        "{results}"
    );
    restarted.stop();

    std::fs::remove_dir_all(directory.path().join("data/search.lancedb")).expect("remove rebuildable vector index");
    let repaired = Server::start(directory.path(), &address, &client);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let results = response_json(
            client.get(format!("{base}/search/records")).query(&[("q", note), ("workflowId", id)]),
            StatusCode::OK,
        );
        if match results["hits"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .iter()
        .any(|hit| hit["workflowId"] == id && hit["text"].as_str().is_some_and(|text| text.contains(note)))
        {
            break;
        }
        assert!(Instant::now() < deadline, "startup repair did not restore the missing index");
        thread::sleep(POLL_INTERVAL);
    }
    let unchanged = response_json(client.get(&workflow), StatusCode::OK);
    assert_eq!(unchanged["version"], 1);
    assert_eq!(unchanged["records"]["goals"], record);
    repaired.stop();

    let output = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
        .current_dir(directory.path())
        .arg("--rebuild-search")
        .env("SQLITE_URL", "sqlite://data/process-flow.sqlite3")
        .env("LANCEDB_URI", "data/search.lancedb")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        use process_flow_application::search::VectorIndex;

        let index =
            process_flow_adapter_lancedb::LanceRecordIndex::connect(&process_flow_adapter_lancedb::LanceConfig {
                uri: directory.path().join("data/search.lancedb").to_string_lossy().into_owned(),
                dimension: 256,
            })
            .await
            .unwrap();
        let vector = process_flow_adapter_embedding::HashingEmbedder::default().vectorize(note);
        let hits = index.nearest(&vector, None, 10).await.unwrap();
        assert!(hits.iter().any(|hit| hit.document.key.workflow_id.as_str() == id
            && hit.document.key.task_id.as_str() == "goals"
            && hit.document.text.contains(note)));
    });
}

#[test]
fn second_server_and_rebuild_cannot_write_to_an_active_store() {
    let directory = tempfile::tempdir().unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap().to_string();
    drop(listener);
    let client = Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
    let server = Server::start(directory.path(), &address, &client);
    for args in [vec![], vec!["--rebuild-search"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
            .current_dir(directory.path())
            .args(args)
            .env("SQLITE_URL", "sqlite://data/process-flow.sqlite3")
            .env("LANCEDB_URI", "data/search.lancedb")
            .env("APP_PORT", "0")
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains("already in use"));
    }
    server.stop();
    let output = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
        .current_dir(directory.path())
        .arg("--rebuild-search")
        .env("SQLITE_URL", "sqlite://data/process-flow.sqlite3")
        .env("LANCEDB_URI", "data/search.lancedb")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

fn available_address() -> String {
    TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().to_string()
}

#[test]
fn memory_servers_use_independent_storage_without_sqlite_lock_files() {
    let directory = tempfile::tempdir().unwrap();
    let client = Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
    let first = Server::start_with_storage(
        directory.path(),
        &available_address(),
        &client,
        "sqlite::memory:",
        &directory.path().join("first.lancedb"),
    );
    let synthetic_lock = std::fs::read_dir(directory.path())
        .unwrap()
        .any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with("file:sqlx-in-memory"));
    assert!(!synthetic_lock, "memory SQLite must not create a filesystem lock");
    let second = Server::start_with_storage(
        directory.path(),
        &available_address(),
        &client,
        "sqlite::memory:",
        &directory.path().join("second.lancedb"),
    );
    second.stop();
    first.stop();
}

#[test]
fn rebuild_preserves_sqlite_and_unrelated_files_inside_lance_root() {
    let directory = tempfile::tempdir().unwrap();
    let address = available_address();
    let client = Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap();
    let sqlite_path = directory.path().join("data/process-flow.sqlite3");
    let sqlite_url = format!("sqlite://{}", sqlite_path.display());
    let lance_path = directory.path().join("data");
    let server = Server::start_with_storage(directory.path(), &address, &client, &sqlite_url, &lance_path);
    let setup = client
        .post(format!("http://{address}/api/v1/auth/setup"))
        .json(&json!({"email": "keep@example.com", "name": "Keep", "password": "preserve-password"}))
        .send()
        .unwrap();
    assert_eq!(setup.status(), StatusCode::CREATED);
    server.stop();
    let unrelated = lance_path.join("keep.txt");
    std::fs::write(&unrelated, "unrelated content").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
        .current_dir(directory.path())
        .arg("--rebuild-search")
        .env("SQLITE_URL", &sqlite_url)
        .env("LANCEDB_URI", &lance_path)
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert!(sqlite_path.is_file(), "rebuilding search moved the authoritative SQLite database");
    assert_eq!(std::fs::read_to_string(&unrelated).unwrap(), "unrelated content");
    let server = Server::start_with_storage(directory.path(), &address, &client, &sqlite_url, &lance_path);
    let status = response_json(client.get(format!("http://{address}/api/v1/auth/status")), StatusCode::OK);
    assert_eq!(status["setupRequired"], false);
    server.stop();
}

#[test]
fn rebuild_rejects_sqlite_inside_the_owned_lance_table_directory() {
    let directory = tempfile::tempdir().unwrap();
    let sqlite_path = directory.path().join("search.lancedb/search_documents.lance/source.sqlite3");
    let sqlite_url = format!("sqlite://{}", sqlite_path.display());
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let pool = process_flow_adapter_sqlite::connect(&process_flow_adapter_sqlite::SqliteConfig {
            url: sqlite_url.clone(),
        })
        .await
        .unwrap();
        sqlx::query("CREATE TABLE preserved (value TEXT NOT NULL)").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO preserved VALUES ('original')").execute(&pool).await.unwrap();
        pool.close().await;
    });
    let output = Command::new(env!("CARGO_BIN_EXE_process-flow-server"))
        .current_dir(directory.path())
        .arg("--rebuild-search")
        .env("SQLITE_URL", &sqlite_url)
        .env("LANCEDB_URI", directory.path().join("search.lancedb"))
        .output()
        .unwrap();
    assert!(!output.status.success(), "rebuilding must reject SQLite inside the table being replaced");
    assert!(String::from_utf8_lossy(&output.stderr).contains("SQLite database must be outside"));
    assert!(sqlite_path.is_file());
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let pool = process_flow_adapter_sqlite::connect(&process_flow_adapter_sqlite::SqliteConfig { url: sqlite_url })
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT value FROM preserved").fetch_one(&pool).await.unwrap(),
            "original"
        );
        pool.close().await;
    });
}
