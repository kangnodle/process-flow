# Clean Architecture Context Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Preserve existing HTTP, storage, and user workflows while separating pure domain and application decisions from effect execution.

**Architecture:** Keep the npm and Cargo workspaces. Model business collaboration through explicit Context inputs and roles, compute ADT transitions and effect descriptions in application, and interpret them through injected ports in runtime. UI binds use cases rather than repositories.

**Tech Stack:** TypeScript, React 19, Vitest, Rust 2024, Cargo, SQLite, LanceDB, Node standard library tooling.

**Spec:** `docs/superpowers/specs/2026-11-20-clean-architecture-refactor-design.md`

## Global Constraints

- Preserve existing API JSON, persisted JSON, HTTP error codes, permissions, command ordering, and document validation.
- Keep existing workspace names, execution paths, and the previous breadcrumb layout change.
- Domain has no external runtime dependencies or I/O. Application contains pure policies and port contracts only.
- No explanatory comments in source files, cross-package relative imports, circular dependencies, or new frameworks.
- Record editing debounces for 500ms. Never replay a failed workflow command automatically.
- Context-specific DCI roles do not replace server authorization.
- Complete every task and run all frontend and backend checks without additional approval gates.

## Review Focus

- A response from an older load generation must not overwrite a newer workspace or authenticated session.
- Record edits while a command is in flight must preserve both the command being sent and later edits.
- A failed preference write must retain its patch and expose a retryable result.
- A successful user update followed by a failed password update must preserve and report the successful update.
- Legacy valid JSON must round-trip unchanged, and malformed record data must retain its existing error classification.

## Task 1: Shared Catalog and Enforced Workspace Boundaries

**Files:** Create `contracts/task-forms.json`, `tools/catalog/`, and `tools/architecture/`; modify `backend/crates/core/domain/Cargo.toml`, remove `backend/crates/core/domain/build.rs`, modify `backend/crates/core/domain/src/workflow/document.rs`, `frontend/package.json`, `mise.toml`.

**Interfaces:** The catalog generator consumes the canonical JSON and emits the existing frontend JSON plus `backend/crates/core/domain/src/workflow/task_forms.rs`. `node tools/catalog/generate.mjs --check` verifies without mutation. Architecture tooling consumes Cargo metadata and workspace manifests and fails on prohibited edges.

- [x] Add Node tests for deterministic catalog generation, invalid catalogs, drift detection, and prohibited dependency edges; watch them fail.
- [x] Implement pure generation and validation separately from filesystem and subprocess entry points.
- [x] Replace Rust build-time file access with a static generated module; preserve task form behavior.
- [x] Wire generation freshness and dependency validation into existing workspace check entry points and verify fixtures exercise the restrictions.
- [x] Run Node tests and catalog freshness checks plus Rust domain tests.

## Task 2: Rust Domain ADTs and Pure Business Contexts

**Files:** Modify `backend/crates/core/domain/src/workflow/{state,document,rules}.rs`, API and SQLite mapping consumers and their tests; create `backend/crates/core/application/src/contexts/`; modify `backend/crates/runtime/src/use_cases/{auth,workflow,membership,user}.rs`; split `application/src/ports.rs` into focused modules with compatible re-exports.

**Interfaces:** `ReviewStatus` is an enum mapped to pending/passed/blocked only in adapters. `Evidence` represents link and file variants with valid variant fields. Pure authentication functions consume explicit timestamps and settings, and return throttle/session decisions. Workflow execution Context binds actor, assignments, role, workflow and process before invoking the existing pure command decision.

- [x] Add failing domain and adapter contract tests for variant semantics, existing record JSON, malformed command status codes, and session/throttle boundary times.
- [x] Introduce internal ADTs while retaining wire DTOs and mapping malformed command records to the current application errors.
- [x] Extract authentication timing and throttle decisions; retain hashing, dummy verification, token generation, locks, and repository calls in runtime.
- [x] Extract business Contexts and focus port modules without breaking public imports.
- [x] Run Rust domain/application/runtime/API/SQLite tests and format/type checks.

## Task 3: Workflow Pure Synchronization and Effect Interpreter

**Files:** Create `frontend/packages/application/src/contexts/workflow/`; modify `frontend/packages/runtime/src/workflow/workflowSession.ts`; add transition tests and extend session tests; update application and runtime public exports.

**Interfaces:** `transitionWorkflowSession(state, event, context)` returns a readonly next state and typed effect descriptions. `WorkflowSession` preserves open/refresh/reload/dispatch/flush/restoreDraft/savePreferences/saveAssignments/getSnapshot/subscribe. View projection preserves existing provider snapshot fields.

- [x] Add failing pure transition and runtime tests for queued edits, reload generations, permission loss, draft restoration, failed preference preservation, and concurrent flush.
- [x] Move decision state, queue operations and response reconciliation into application Context modules and tagged states.
- [x] Implement runtime effect interpretation through WorkflowRepository and Scheduler; use monotonic request identities to ignore stale completions.
- [x] Separate preference state and execution from workflow persistence and retain failed patches for explicit retry.
- [x] Verify pure transitions, session tests, and existing persistence/draft/assignment integration tests.

## Task 4: Management Use Cases and React Bindings

**Files:** Create management Context contracts under `frontend/packages/application/src/contexts/`, runtime management use cases under `frontend/packages/runtime/src/`; modify `react/src/projects/{ProjectsProvider,projectsContext}`, `react/src/work/useMyWork.ts`, `ui/src/pages/{ProjectsPage,UsersPage}.tsx`, and `ui/src/components/ProjectMembers.tsx`.

**Interfaces:** Project, member, user and work use-case interfaces expose business operations without exposing repository instances. Runtime implements them with injected ports. User editing accepts metadata and optional password as a single use case and exposes partial-success data on password failure. UI hooks expose observable loading/failure/result states.

- [x] Add failing use-case tests for operation sequencing, partial user success, denied changes, and stale loads.
- [x] Extract pure operation plans and define focused application interfaces; implement runtime calls and error conversion.
- [x] Replace UI repository access with use cases and reduce React providers to bindings and subscriptions; preserve existing page behavior.
- [x] Surface formerly discarded project/member errors and retain retry paths.
- [x] Run management runtime tests and existing project/user/member/my-work UI integration tests.

## Task 5: Authentication and TypeScript Evidence ADTs

**Files:** Create `application/src/contexts/auth/` and `runtime/src/auth/`; modify `react/src/auth/{AuthProvider,authContext}`; modify `domain/src/workflow/state.ts`, Evidence consumers, HTTP decoder, and tests.

**Interfaces:** `transitionAuth(state, event)` returns tagged authentication state and effects. Runtime authentication session implements status/setup/login/logout/changePassword/retry with observable state and request generation. `Evidence` is a discriminated link/file union with compatible JSON field names.

- [x] Add failing authentication transition/session tests including expired and stale responses, setup conflict, and logout failure.
- [x] Implement pure auth transitions, effectful session, and a React subscription binding without retaining passwords in snapshots.
- [x] Narrow Evidence variants and update decoders, editors, and file adapters with explicit type-safe construction.
- [x] Run auth/document/evidence integration and decoder tests.

## Task 6: Integration, Review and Full Verification

**Files:** Update `frontend/eslint.config.js`, architecture tooling, relevant READMEs and this plan's execution ledger.

**Interfaces:** Public package entrypoints preserve existing exports and expose used Contexts/use cases only. Check commands cover catalog drift, dependency direction, UI repository boundaries and pure code restrictions.

- [x] Add negative architecture fixtures for UI repositories and forbidden pure imports.
- [x] Run frontend `npm run check` and `npm run build`.
- [x] Run backend `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace --locked`.
- [x] Run catalog freshness and architecture checks and review `git diff --check`.
- [x] Request an independent whole-change review, resolve consequential findings, and rerun affected checks.
- [x] Report actual completed scope, verification counts, and any remaining limitations.
