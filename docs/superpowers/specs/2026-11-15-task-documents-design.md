# Document-first task completion

Approved in chat: the user selected the document-style mockup and requested implementation of all 25 task forms, required content/completion gates, links and file evidence.

## Behavior
- Stage and board show status and open the task document; neither directly completes work.
- Each task has required, task-specific answers. Drafts save freely. Completion requires all answers, an explicit passed review (no blocking issues), successful persistence and completed evidence reads.
- Evidence is optional and never replaces answers. Multiple links/files have titles and descriptions; authenticated workflow storage owns evidence. Files download as attachments, never execute inline.
- Completed records are read-only until reopen/rework. Retain existing notes/links. Legacy completed records are labeled unverified and must be reworked before they can satisfy new approval rules.
- Previous task contents and evidence are readable in the document screen. Stage approval shows all deliverables and supports existing rework controls.
- Preserve sequential phase/assignment/role/version checks. Server is authoritative. Preserve drafts on save/version failures.

## Choices
Document-style is selected over guided wizard and board-side editor. Existing React/Fluent UI and Rust/Actix/SurrealDB architecture remains. Use a versioned schema and stable field IDs; no arbitrary form-builder feature.
For bounded evidence storage, use base64 file bytes within the existing authenticated, versioned record transaction: 2 MiB/file, 8 MiB decoded total/workflow, 20 evidence items/task, 16 MiB HTTP JSON cap. No public file URLs or unauthenticated upload directory. This avoids orphaned file lifecycle and requires no object-storage setup; document storage limits prominently.

## Wire contract
Existing TaskRecord {link,note} gains optional document and evidence.
TaskDocument = {version:1, answers: Record<string,string>, reviewStatus:'pending'|'passed'|'blocked'}.
Evidence = {id:string,kind:'link'|'file',title:string,description:string,url?:string,fileName?:string,mediaType?:string,size?:number,base64?:string}.
updateRecord.patch accepts document/evidence in addition to existing fields. Null is not deletion. Replace evidence array to remove an item. New records omit optional fields until edited.
Task catalog frontend export: taskForm(taskId): readonly TaskField[]; TaskField = {id,label:{ko,en},hint:{ko,en},allowNotApplicable?:boolean}. Validation export: validateTaskDocument(taskId,record): readonly string[] (missing/invalid field IDs, plus 'reviewStatus'). Use optional N/A only with explicit nonempty reason, not generic bypass.
Catalog JSON at frontend/packages/domain/src/process/task-forms.json is source of truth, included by Rust; frontend imports it with resolveJsonModule. Any build-path adjustment must retain a parity test.

## Completion and history
Whitespace and placeholder-only content cannot satisfy required fields; missing structured subfields must remain separate fields. Outcome passed is explicit and blocked/pending prevents completion. Completed snapshots and actor/time must remain recoverable through transactional workflow events. Changes after rework append new events without erasing old ones.
