# Backend explicit match implementation plan

**Goal:** Replace every `unwrap()` in `backend/` with an explicit `match`.
**Architecture:** Preserve successful results and public interfaces. Authentication lock poisoning returns an application error; test repository lock poisoning fails with a descriptive diagnostic. Tests retain fail-fast assertions with descriptive messages. Build failures report the affected environment variable or output file.
**Tech Stack:** Rust workspace, Cargo, existing test suites.
**Spec:** User request in this chat (all backend `unwrap()` calls).

- [x] Inventory all calls, including test macros and build scripts, and inspect caller impact.
- [x] Add and run authentication lock-poisoning regression tests before changing runtime behavior.
- [x] Replace runtime/build/store calls with contextual match handling; replace test calls with explicit Result/Option matches.
- [x] Run formatting, workspace tests and Clippy; check that no `unwrap()` calls remain and review the diff.

Constraints: No replacement with `expect`, no dependency additions, no changes to `unwrap_or*` or `unwrap_err` outside the request. Keep lock guards out of await points and preserve temporary lifetimes in chained expressions.
