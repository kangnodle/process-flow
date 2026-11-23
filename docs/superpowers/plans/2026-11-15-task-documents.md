# Task documents implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved document-first workflow and enforced task content with evidence.
**Architecture:** A shared versioned task catalog drives frontend forms and Rust validation. Existing record commands atomically persist answers/evidence and event history. Document UI consumes the same record contract in every view.
**Tech Stack:** TypeScript, React, Fluent UI, Vitest; Rust, Actix, SurrealDB.
**Spec:** docs/superpowers/specs/2026-11-15-task-documents-design.md

## Global Constraints
Preserve existing user changes to .gitignore/.ignore. Work on codex/task-documents; no deployment/push. Preserve legacy notes/links and role/version checks. Never let evidence replace required answers. 2 MiB/file, 8 MiB decoded/workflow, 20 items/task.

## Review Focus
- Direct API completion bypass or forged evidence must fail.
- Completed and locked records cannot be silently edited.
- Version conflicts and file-read failures must preserve drafts and block completion.
- Legacy completion must not be mistaken for validated content.
- Approval and previous-result views must use actual saved records.

### Task 1: Catalog and frontend state
Files: frontend/packages/domain/src/process/task-forms.json, taskForms.ts, workflow/state.ts, reducer.ts; application/workflow/workflowSession.ts; adapter-http workflowRepository.ts and related tests.
Interfaces: exact types/functions in Spec. Shared JSON array/object contract coordinated with backend.
- [x] Write/run failing tests for blank/partial/evidence-only completion, blocked review, completed editing and legacy approval.
- [x] Implement all 25 bilingual forms, validation, serialization, optimistic reducer gates and draft preservation.
- [x] Run frontend domain/application/adapter suites and typecheck; update fixtures with actual required content.

### Task 2: Authoritative storage and validation
Files: backend workflow domain/commands/rules, API DTO/error/JSON limits, Surreal schema/store/events, tests.
Interfaces: Spec wire contract, same shared catalog.
- [x] Write/run failing tests for server completion/approval gate, frozen records, invalid/oversized file evidence.
- [x] Implement draft validation, completion validation, base64 safe bounds, persisted record/event history and backwards-compatible reads.
- [x] Run cargo workspace tests and clippy/format checks; keep role/assignment regressions passing.

### Task 3: Document UI and workflow entry points
Files: frontend/packages/ui/src/components/TaskDocument.tsx, views/TaskView.tsx, StageView.tsx, BoardView.tsx; frontend/apps/web tests.
Interfaces: taskForm, validateTaskDocument, record.document/evidence.
- [x] Write/run failing UI tests for document navigation, required completion and file/link evidence.
- [x] Build document form, required-field indicators, explicit review outcome, optional evidence editing/download, prior results and stage review.
- [x] Remove checkbox completion; preserve rework and approval actions, route cards to document.
- [x] Verify all frontend tests, lint/typecheck/build, and responsive UI.

### Task 4: Integration review
- [x] Review catalog parity, server/API persistence, legacy data, saving/conflict behavior and attachment lifecycle.
- [x] Fix discovered issues, rerun affected checks and report exact limits/results.

## Execution ledger
- Approved design and direct implementation request authorize continuing without another plan approval.
- Current checkout contains unrelated ignore-file edits; a task branch preserves these without moving the user's workspace.
- Parallel work is limited to disjoint frontend model, backend, and UI files after agreeing the wire contract.

## Verification and review results
- Frontend check: formatting, TypeScript, ESLint, 194 default tests passed (one opt-in test separately enabled and passed).
- Actual frontend + Rust server + SurrealKV restart integration: TEST_BACKEND=1 persistence test passed, bringing frontend coverage to 195 passing tests.
- Backend cargo test --workspace: 121 passed; cargo fmt --all -- --check and strict workspace Clippy passed.
- Production frontend build passed; existing large Fluent bundle warning remains.
- Browser: desktop/mobile (390px) rendering checked, no page errors or horizontal overflow; file upload/download, document completion and read-only completed fields verified.
- Fresh reviewer identified conflict-recovery deadlock, unscheduled saving status, file-read navigation busy leak, and internal-switch archive loss. Each was reproduced and fixed with regression tests; targeted final review reported no remaining important findings.
- Ruling: recovery archives full drafts separately and shows authoritative server state; explicit restore resets review and archive clears only after matching content acknowledgement. Browser unload and internal workflow switching protect remaining drafts.
- Changes remain uncommitted on codex/task-documents for user review. Existing .gitignore/.ignore edits were left intact.
