# SQLite and LanceDB Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Independent adapter packages may be delegated under superpowers:dispatching-parallel-agents after their shared contracts are fixed.

**Goal:** Replace the server's SurrealDB persistence with SQLite and preserve vector search using LanceDB.

**Architecture:** SQLite owns authoritative business records and durable search jobs. Separate application ports describe search sources, jobs and vectors; runtime coordinates them. LanceDB is a rebuildable projection validated against SQLite before search results leave the application.

**Tech Stack:** Rust 1.98.0, Actix Web, SQLx SQLite, embedded LanceDB, existing hashing embedder.

**Spec:** `docs/superpowers/specs/2026-11-19-sqlite-lancedb-design.md`

## Global Constraints

- Preserve HTTP JSON, authorization, workflow/version rules, documents, evidence and audit history.
- Keep domain independent of infrastructure and all driver types inside adapter packages.
- Do not add source comments or cross-package relative Rust imports.
- Default to `SQLITE_URL=sqlite://data/process-flow.sqlite3`, `LANCEDB_URI=data/search.lancedb`, embedding dimension 256.
- Support one server process per local data path and multiple HTTP workers.
- Start with fresh SQLite data as authorized by the user; leave existing SurrealDB data untouched. Remove the unfinished runtime snapshot import path. Remove the unused standalone legacy exporter as well.

## Review Focus

- A job committed to LanceDB but not acknowledged in SQLite must safely replay after restart.
- A concurrent delete or newer save must hide obsolete search text and leave durable cleanup work.
- Quotes and unusual Unicode identifiers must not change SQL or Lance filter semantics.
- A missing index must rebuild; a mismatched embedding dimension must fail explicitly.
- Fresh startup must offer administrator setup; memory mode must isolate both stores from existing persistent data.

### Task 1: Establish search contracts and baseline

**Files:** `backend/crates/core/application/src/search.rs`, `backend/crates/core/application/src/lib.rs`, workspace manifests.

**Interfaces:** `SearchKey { workflow_id, task_id }`; `SearchDocument { key, revision: u64, text }`; `SearchJob { id: u64, document, attempts: u32 }`; `SearchCandidate { document, score: f64 }`. `SearchSource` provides `current`, paginated `page`, and conditional `enqueue`. `SearchJobs` provides `pending`, `acknowledge`, and `retry`. `VectorIndex` provides `upsert`, `remove`, `nearest`, and paginated `documents`.

- [x] Run existing backend tests and record baseline evidence.
- [x] Add contracts, preserving existing repository ports during transition.
- [x] Compile application and domain packages; commit the contracts.

### Task 2: Implement SQLite repositories and durable outbox

**Files:** `backend/crates/adapters/sqlite/Cargo.toml`, `src/{lib,schema,process_store,project_store,user_store,session_store,membership_store,workflow_store,assignment_store,preferences_store,search_store}.rs`, `migrations/0001_initial.sql`, `tests/repositories.rs`.

**Interfaces:** `SqliteConfig { url: String }`, `connect(&SqliteConfig) -> RepoResult<SqlitePool>`, `Sqlite*Store::new(SqlitePool)` implement existing repository ports. `SqliteSearchStore::new(SqlitePool)` implements `SearchSource` and `SearchJobs`.

- [x] Write failing real-SQLite tests for repository contracts, ordered prerequisites, transactions, duplicate bootstrap, optimistic locking, documents/evidence, durable jobs and delete cleanup.
- [x] Run them to demonstrate missing implementation.
- [x] Implement versioned schema, row conversion and focused repositories with bound parameters, foreign keys, WAL and busy timeout. Allocate persistent search revisions only when searchable text changes; enqueue deletes before cascade deletion.
- [x] Prove conditional acknowledgements and repair enqueue cannot remove or replace newer work; restart tests must retain due time and attempts.
- [x] Run `cargo test -p process-flow-adapter-sqlite`; commit the package.

### Task 3: Implement LanceDB vector adapter

**Files:** `backend/crates/adapters/lancedb/{Cargo.toml,src/{lib,rows,schema,vectors}.rs,tests/search.rs}`.

**Interfaces:** `LanceConfig { uri: String, dimension: usize }`, `LanceRecordIndex::connect(&LanceConfig) -> RepoResult<Self>`, implements `VectorIndex` from Task 1.

- [x] Write and run failing real-LanceDB tests for cosine ranking, scope, idempotent upsert/delete, persistence, pagination, quoted IDs, zero vectors and dimension mismatch.
- [x] Implement one row per search key with revision, exact cosine search initially, deterministic pagination and metadata validation. Serialize writes; do not expose Arrow types through ports.
- [x] Run `cargo test -p process-flow-adapter-lancedb`; commit the package.

### Task 4: Connect runtime search and server lifecycle

**Files:** `backend/crates/runtime/src/{indexing,use_cases/search}.rs`, application ports, testing memory adapters, runtime tests, `backend/apps/server/src/{config,wiring,main}.rs`, server persistence tests, system adapter.

**Interfaces:** `sync_search_jobs(jobs: &dyn SearchJobs, source: &dyn SearchSource, index: &dyn VectorIndex, embedder: &dyn Embedder, clock: &dyn Clock)`; `repair_search_index(source,index)`; `SearchService::new(index,source,embedder,workflows,access)`.

- [x] Write failing runtime tests for stale completion, independent failures, retries and authorized current-result validation.
- [x] Implement orchestration, source validation and candidate expansion; update memory test doubles and remove obsolete unified search port.
- [x] Write failing process tests for SQLite/Lance restart, missing-index repair and exclusive data lock.
- [x] Replace server configuration/wiring, acquire canonical-path OS locks and drain worker tasks on graceful shutdown. Add offline search rebuild entry point.
- [x] Verify that memory SQLite takes no synthetic filesystem lock and two memory servers can run from the same working directory.
- [x] Disable lifetime and idle retirement of the sole memory connection; verify actual pool configuration for unnamed and named memory URLs.
- [x] Rebuild only the adapter-owned Lance table directory; prove that a SQLite file and unrelated files nested inside the Lance root remain at their original paths.
- [x] Run runtime/API/server tests; commit integration.

### Task 5: Start with fresh SQLite data

**Files:** server operation/main modules, SQLite snapshot module/tests, backend README.

- [x] Reject the removed `--import-snapshot` operation in a test and observe its failure.
- [x] Remove the unfinished importer and its obsolete migration tests, and the unused standalone exporter.
- [x] Document initial administrator setup and fresh SQLite paths.
- [x] Verify command parsing and SQLite repository tests.

### Task 6: Remove runtime SurrealDB and verify whole application

**Files:** workspace manifests/lock, unused exporter, README and backend docs, env examples, benchmark examples and Surreal-only build configuration.

- [x] Remove runtime SurrealDB package/dependencies and obsolete tests after their behavior is covered by new adapter/integration tests.
- [x] Update operator instructions for fresh startup, backup, index rebuild, local paths and single-process operation.
- [x] Run `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`, existing frontend tests and the optional real-backend frontend persistence test.
- [x] Request fresh whole-branch review, address important findings with regression tests, verify and commit final changes.

## Completion evidence

Search contracts, SQLite repositories and runtime wiring were present at the start of this continuation and were reused. The remaining LanceDB implementation and SurrealDB removal are complete. Fresh-data startup replaces the original migration task at the user's direction.

- Backend: `cargo test --workspace` — 152 passed, including 19 SQLite tests, 13 LanceDB tests and 5 server process tests.
- Frontend: `TEST_BACKEND=1 npm test -- --maxWorkers=2` — 204 passed, including real backend persistence.
- Checks: backend formatting and Clippy with warnings denied; frontend typecheck, ESLint and Prettier all passed.
- Independent review: fixed unsafe rebuild directory replacement, synthetic memory SQLite locking and memory connection retirement. Added a canonical-path guard for SQLite located inside the owned Lance table directory.
- Verified populated offline rebuild by reopening the rebuilt native index and querying its persisted documents.
- Bash memory-mode behavior verified for isolation, cleanup on success/failure and exit status. PowerShell was reviewed statically because this environment has no PowerShell executable.
- Validation used the cached native `protoc` and a temporary linker wrapper selecting the toolchain LLD; repository toolchain and linker settings were not changed.
