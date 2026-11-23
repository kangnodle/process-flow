use std::collections::BTreeMap;

use process_flow_adapter_sqlite::{
    SqliteAssignmentStore, SqliteConfig, SqliteMembershipStore, SqlitePreferencesStore, SqliteProcessStore,
    SqliteProjectStore, SqliteSearchStore, SqliteSessionStore, SqliteUserStore, SqliteWorkflowStore, connect,
};
use process_flow_application::RepositoryError;
use process_flow_application::ports::{
    AssignmentRepository, CredentialRepository, MembershipRepository, PreferencesRepository, ProcessGraph,
    ProcessRepository, ProjectRepository, RecordedEvent, Session, SessionRepository, UserRepository,
    WorkflowRepository,
};
use process_flow_application::preferences::{Locale, Theme, WorkspacePreferences};
use process_flow_application::search::{SearchDocument, SearchJobs, SearchKey, SearchSource};
use process_flow_domain::assignment::{Assignments, Authority, StageAssignment};
use process_flow_domain::membership::{Membership, Role};
use process_flow_domain::process::{ProcessSpec, StageSpec, define_process};
use process_flow_domain::project::Project;
use process_flow_domain::user::User;
use process_flow_domain::workflow::{Event, Evidence, FileEvidence, Phase, TaskDocument, TaskRecord, Workflow};
use sqlx::SqlitePool;

struct Database {
    config: SqliteConfig,
    _directory: tempfile::TempDir,
}

impl Database {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let config = SqliteConfig { url: format!("sqlite://{}/process-flow.sqlite3", directory.path().display()) };
        Self { config, _directory: directory }
    }

    async fn open(&self) -> SqlitePool {
        connect(&self.config).await.unwrap()
    }
}

fn project(id: &str) -> Project {
    Project::create(id.into(), "Project", Some("Description")).unwrap()
}

fn user(id: &str) -> User {
    User::create(id.into(), &format!("{id}@example.com"), "User").unwrap()
}

fn workflow(id: &str) -> Workflow {
    Workflow::start(id.into(), "project".into(), "process".into(), "Workflow".into())
}

async fn seed(pool: &SqlitePool) {
    SqliteProjectStore::new(pool.clone()).insert(&project("project"), None, 0).await.unwrap();
    SqliteUserStore::new(pool.clone()).insert(&user("actor"), 0).await.unwrap();
    let process = define_process(ProcessSpec {
        id: "process".into(),
        stages: vec![
            StageSpec { id: "first".into(), tasks: vec!["z".into(), "a".into()] },
            StageSpec { id: "second".into(), tasks: vec!["b".into(), "c".into()] },
            StageSpec { id: "third".into(), tasks: vec!["d".into()] },
        ],
    })
    .unwrap();
    SqliteProcessStore::new(pool.clone()).save(&process).await.unwrap();
    assert_eq!(SqliteProcessStore::new(pool.clone()).find(process.id()).await.unwrap(), Some(process));
}

fn search_key(id: &str, task: &str) -> SearchKey {
    SearchKey { workflow_id: id.into(), task_id: task.into() }
}

fn change(previous: &Workflow, task: &str, record: TaskRecord) -> (Workflow, RecordedEvent) {
    let mut state = previous.state.clone();
    state.records.insert(task.into(), record.clone());
    let next = previous.with_state(state);
    let event = RecordedEvent {
        workflow_id: next.id.clone(),
        version: next.version,
        occurred_at_ms: 50,
        actor: "actor".into(),
        authority: Authority::Assigned,
        event: Event::RecordUpdated { task_id: task.into(), record },
    };
    (next, event)
}

fn note(text: &str) -> TaskRecord {
    TaskRecord { note: text.into(), ..TaskRecord::default() }
}

#[tokio::test]
async fn migrations_enable_wal_and_foreign_keys() {
    let db = Database::new();
    let pool = db.open().await;
    assert_eq!(sqlx::query_scalar::<_, String>("PRAGMA journal_mode").fetch_one(&pool).await.unwrap(), "wal");
    let mut first = pool.acquire().await.unwrap();
    let mut second = pool.acquire().await.unwrap();
    assert_eq!(sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys").fetch_one(&mut *first).await.unwrap(), 1);
    assert_eq!(sqlx::query_scalar::<_, i64>("PRAGMA foreign_keys").fetch_one(&mut *second).await.unwrap(), 1);
}

#[tokio::test]
async fn prerequisites_are_all_earlier_stages_in_task_number_order() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let processes = SqliteProcessStore::new(pool);
    assert_eq!(
        processes.prerequisites(&"process".into(), &"d".into()).await.unwrap(),
        vec!["z".into(), "a".into(), "b".into(), "c".into()]
    );
    assert_eq!(processes.prerequisites(&"process".into(), &"c".into()).await.unwrap(), vec!["z".into(), "a".into()]);
    assert!(processes.prerequisites(&"other".into(), &"d".into()).await.unwrap().is_empty());
    assert!(processes.find(&"missing".into()).await.unwrap().is_none());
}

#[tokio::test]
async fn projects_and_owner_membership_commit_together() {
    let db = Database::new();
    let pool = db.open().await;
    let projects = SqliteProjectStore::new(pool.clone());
    let users = SqliteUserStore::new(pool.clone());
    let members = SqliteMembershipStore::new(pool);
    let mut active = project("p");
    assert!(projects.insert(&active, Some(&"missing".into()), 0).await.is_err());
    assert!(projects.find(&active.id).await.unwrap().is_none());
    let owner = user("owner");
    users.insert(&owner, 0).await.unwrap();
    projects.insert(&active, Some(&owner.id), 0).await.unwrap();
    assert!(matches!(projects.insert(&active, None, 0).await, Err(RepositoryError::AlreadyExists(_))));
    assert_eq!(
        members.members(&active.id).await.unwrap(),
        [Membership { project_id: active.id.clone(), user_id: owner.id.clone(), role: Role::Owner }]
    );
    assert_eq!(members.memberships_of(&owner.id).await.unwrap().len(), 1);
    members
        .put(&Membership { project_id: active.id.clone(), user_id: owner.id.clone(), role: Role::Viewer }, 1)
        .await
        .unwrap();
    assert_eq!(members.memberships_of(&owner.id).await.unwrap()[0].role, Role::Viewer);
    active.archived = true;
    active.version = 1;
    projects.update(&active, 0, 1).await.unwrap();
    assert!(matches!(projects.update(&active, 0, 2).await, Err(RepositoryError::VersionConflict { expected: 0 })));
    assert!(projects.list(false).await.unwrap().is_empty());
    assert_eq!(projects.list(true).await.unwrap(), [active.clone()]);
    assert!(members.remove(&active.id, &owner.id).await.unwrap());
    assert!(!members.remove(&active.id, &owner.id).await.unwrap());
}

#[tokio::test]
async fn bootstrap_can_be_won_once_and_failed_credentials_roll_back() {
    let db = Database::new();
    let pool = db.open().await;
    let users = SqliteUserStore::new(pool.clone());
    let mut first = user("first");
    first.is_admin = true;
    let mut second = user("second");
    second.is_admin = true;

    sqlx::query(
        "CREATE TRIGGER reject_credentials BEFORE INSERT ON credentials BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(users.save_first_admin(&first, "first-hash", 0).await.is_err());
    assert!(!users.has_admin().await.unwrap());
    assert!(UserRepository::find(&users, &first.id).await.unwrap().is_none());
    sqlx::query("DROP TRIGGER reject_credentials").execute(&pool).await.unwrap();

    let (first_won, second_won) = tokio::join!(
        users.save_first_admin(&first, "first-hash", 1),
        users.save_first_admin(&second, "second-hash", 1),
    );
    let (winner, loser, hash) = match (first_won.unwrap(), second_won.unwrap()) {
        (true, false) => (first, second, "first-hash"),
        (false, true) => (second, first, "second-hash"),
        result => panic!("expected a single bootstrap winner: {result:?}"),
    };
    assert_eq!(CredentialRepository::find(&users, &winner.id).await.unwrap().as_deref(), Some(hash));
    assert!(UserRepository::find(&users, &loser.id).await.unwrap().is_none());
}

#[tokio::test]
async fn users_enforce_unique_email_and_sessions_preserve_digest_and_expiry() {
    let db = Database::new();
    let pool = db.open().await;
    let users = SqliteUserStore::new(pool.clone());
    let sessions = SqliteSessionStore::new(pool);
    let mut member = user("member");
    users.insert(&member, 1).await.unwrap();
    assert_eq!(users.find_by_email("member@example.com").await.unwrap(), Some(member.clone()));
    let duplicate = User { id: "other".into(), ..member.clone() };
    assert!(
        matches!(users.insert(&duplicate, 1).await, Err(RepositoryError::AlreadyExists(email)) if email == "member@example.com")
    );
    member.active = false;
    member.version = 1;
    users.update(&member, 0, 2).await.unwrap();
    assert!(matches!(users.update(&member, 0, 3).await, Err(RepositoryError::VersionConflict { expected: 0 })));
    assert!(users.list(false).await.unwrap().is_empty());
    for (digest, expires_at_ms) in [("keep", 10), ("purge", 11)] {
        sessions
            .insert(&Session { token_digest: digest.into(), user_id: member.id.clone(), expires_at_ms }, 4)
            .await
            .unwrap();
    }
    let (session, joined_user) = sessions.find_with_user("keep").await.unwrap().unwrap();
    assert_eq!(session.expires_at_ms, 10);
    assert_eq!(joined_user, Some(member.clone()));
    sessions.remove_for_user(&member.id, Some("keep")).await.unwrap();
    assert!(sessions.find("purge").await.unwrap().is_none());
    sessions.extend("keep", 20).await.unwrap();
    sessions.remove_expired(19).await.unwrap();
    assert_eq!(sessions.find("keep").await.unwrap().unwrap().expires_at_ms, 20);
    sessions.remove_expired(20).await.unwrap();
    assert!(sessions.find("keep").await.unwrap().is_none());
}

#[tokio::test]
async fn workflow_version_records_audit_and_outbox_roll_back_together() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool.clone());
    let initial = workflow("w");
    workflows.insert(&initial, 0).await.unwrap();
    let (first, first_event) = change(&initial, "z", note("winner one"));
    let (second, second_event) = change(&initial, "z", note("winner two"));
    let mut invalid_event = first_event.clone();
    invalid_event.actor = "missing".into();
    assert!(workflows.update(&first, 0, &[first_event.clone(), invalid_event]).await.is_err());
    assert_eq!(workflows.find(&initial.id).await.unwrap(), Some(initial.clone()));
    assert!(search.pending(0, 10).await.unwrap().is_empty());
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM workflow_events").fetch_one(&pool).await.unwrap(), 0);
    let (left, right) = tokio::join!(
        workflows.update(&first, 0, std::slice::from_ref(&first_event)),
        workflows.update(&second, 0, std::slice::from_ref(&second_event)),
    );
    let winner = match (left, right) {
        (Ok(()), Err(RepositoryError::VersionConflict { expected: 0 })) => first,
        (Err(RepositoryError::VersionConflict { expected: 0 }), Ok(())) => second,
        result => panic!("expected a single workflow version winner: {result:?}"),
    };
    assert_eq!(workflows.find(&initial.id).await.unwrap(), Some(winner.clone()));
    let jobs = search.pending(0, 10).await.unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].document.text, winner.state.records[&"z".into()].note);
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT authority FROM workflow_events").fetch_one(&pool).await.unwrap(),
        "assigned"
    );
}

#[tokio::test]
async fn documents_evidence_and_due_jobs_survive_restart() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let initial = workflow("w");
    let workflows = SqliteWorkflowStore::new(pool.clone());
    workflows.insert(&initial, 0).await.unwrap();
    let record = TaskRecord {
        link: "https://example.com".into(),
        note: "검토".into(),
        document: Some(TaskDocument {
            version: 2,
            answers: BTreeMap::from([("answer".into(), "decision".into())]),
            review_status: process_flow_domain::workflow::ReviewStatus::Passed,
        }),
        evidence: Some(vec![Evidence::File(FileEvidence {
            id: "e".into(),
            title: "drawing".into(),
            description: "evidence".into(),
            file_name: "drawing.txt".into(),
            media_type: Some("text/plain".into()),
            size: 3,
            base64: "YWJj".into(),
        })]),
    };
    let (changed, event) = change(&initial, "z", record);
    workflows.update(&changed, 0, &[event]).await.unwrap();
    let search = SqliteSearchStore::new(pool.clone());
    let job = search.pending(0, 1).await.unwrap().pop().unwrap();
    assert_eq!(job.document.text, "검토\nhttps://example.com\ndecision\ndrawing\nevidence");
    search.retry(&job, 500).await.unwrap();
    pool.close().await;
    let pool = db.open().await;
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool.clone());
    assert_eq!(workflows.find(&initial.id).await.unwrap(), Some(changed.clone()));
    assert!(workflows.list(None).await.unwrap()[0].state.records.is_empty());
    assert!(workflows.list_in(&["project".into()]).await.unwrap()[0].state.records.is_empty());
    assert!(workflows.list_in(&[]).await.unwrap().is_empty());
    let event = sqlx::query_as::<_, (i64, i64, String, String, String)>(
        "SELECT version, occurred_at_ms, actor_id, kind, payload FROM workflow_events",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((&event.0, &event.1, event.2.as_str(), event.3.as_str()), (&1, &50, "actor", "recordUpdated"));
    let payload: serde_json::Value = serde_json::from_str(&event.4).unwrap();
    assert_eq!(payload["evidence"][0]["base64"], "YWJj");
    assert!(search.pending(499, 1).await.unwrap().is_empty());
    let retried = search.pending(500, 1).await.unwrap().pop().unwrap();
    assert_eq!(retried.id, job.id);
    assert_eq!(retried.document, job.document);
    assert_eq!(retried.attempts, 1);
}

#[tokio::test]
async fn newer_search_jobs_survive_stale_workers_and_repair_snapshots() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool);
    let initial = workflow("w");
    let other = workflow("w'; SELECT");
    workflows.insert(&initial, 0).await.unwrap();
    workflows.insert(&other, 0).await.unwrap();

    let (first, event) = change(&initial, "z", note("first"));
    workflows.update(&first, 0, &[event]).await.unwrap();
    let first_job = search.pending(0, 1).await.unwrap().pop().unwrap();
    let mut state = first.state.clone();
    state.phase = Phase::Working { stage_index: 0, completed: 1 };
    let phase_only = first.with_state(state);
    workflows.update(&phase_only, 1, &[]).await.unwrap();
    assert_eq!(search.current(&first_job.document.key).await.unwrap(), Some(first_job.document.clone()));
    assert_eq!(search.pending(0, 1).await.unwrap().as_slice(), std::slice::from_ref(&first_job));

    let (second, event) = change(&phase_only, "z", note("second"));
    workflows.update(&second, 2, &[event]).await.unwrap();
    let second_job = search.pending(0, 1).await.unwrap().pop().unwrap();
    assert!(second_job.document.revision > first_job.document.revision);
    assert_ne!(second_job.id, first_job.id);
    search.acknowledge(&first_job).await.unwrap();
    search.retry(&first_job, 100).await.unwrap();
    assert!(!search.enqueue(&first_job.document).await.unwrap());
    assert!(!search.enqueue(&second_job.document).await.unwrap());
    assert_eq!(search.pending(0, 1).await.unwrap().as_slice(), std::slice::from_ref(&second_job));

    let (other_changed, event) = change(&other, "a", note("another"));
    workflows.update(&other_changed, 0, &[event]).await.unwrap();
    let first_page = search.page(None, 1).await.unwrap();
    let second_page = search.page(Some(&first_page[0].key), 1).await.unwrap();
    assert_eq!(first_page[0].key, search_key("w", "z"));
    assert_eq!(second_page[0].key, search_key("w'; SELECT", "a"));
    assert!(second_page[0].revision > second_job.document.revision);
    assert!(search.page(Some(&second_page[0].key), 1).await.unwrap().is_empty());

    search.acknowledge(&second_job).await.unwrap();
    assert!(search.enqueue(&second_job.document).await.unwrap());
    let repair = search
        .pending(0, 10)
        .await
        .unwrap()
        .into_iter()
        .find(|job| job.document.key == second_job.document.key)
        .unwrap();
    assert_ne!(repair.id, second_job.id);
    search.acknowledge(&second_job).await.unwrap();
    assert!(search.pending(0, 10).await.unwrap().contains(&repair));
}

#[tokio::test]
async fn empty_search_text_and_project_cascades_leave_durable_deletion_jobs() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let projects = SqliteProjectStore::new(pool.clone());
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool.clone());
    let initial = workflow("w");
    workflows.insert(&initial, 0).await.unwrap();
    let (first, event) = change(&initial, "z", note("erase this"));
    workflows.update(&first, 0, &[event]).await.unwrap();
    let first_job = search.pending(0, 1).await.unwrap().pop().unwrap();
    let (cleared, event) = change(&first, "z", TaskRecord::default());
    workflows.update(&cleared, 1, &[event]).await.unwrap();
    let tombstone = search.pending(0, 1).await.unwrap().pop().unwrap();
    assert!(tombstone.document.text.is_empty());
    assert!(tombstone.document.revision > first_job.document.revision);
    assert!(search.current(&tombstone.document.key).await.unwrap().is_none());
    let (with_other_record, event) = change(&cleared, "a", note("delete with project"));
    workflows.update(&with_other_record, 2, &[event]).await.unwrap();
    let other_job =
        search.pending(0, 10).await.unwrap().into_iter().find(|job| job.document.key.task_id.as_str() == "a").unwrap();

    assert!(matches!(
        projects.delete_archived(&initial.project_id, 0).await,
        Err(RepositoryError::VersionConflict { expected: 0 })
    ));
    let mut archived = project("project");
    archived.archived = true;
    archived.version = 1;
    projects.update(&archived, 0, 1).await.unwrap();
    projects.delete_archived(&archived.id, 1).await.unwrap();
    assert!(projects.find(&archived.id).await.unwrap().is_none());
    assert!(workflows.find(&initial.id).await.unwrap().is_none());
    assert!(search.page(None, 10).await.unwrap().is_empty());
    assert!(!search.enqueue(&other_job.document).await.unwrap());
    assert!(!search.enqueue(&tombstone.document).await.unwrap());
    search.acknowledge(&other_job).await.unwrap();
    let deletions = search.pending(0, 10).await.unwrap();
    assert_eq!(deletions.len(), 2);
    assert!(deletions.iter().all(|job| job.document.text.is_empty()));
    let deletion = deletions.into_iter().find(|job| job.document.key == other_job.document.key).unwrap();
    assert!(deletion.document.revision > other_job.document.revision);
    assert_eq!(sqlx::query_scalar::<_, i64>("SELECT count(*) FROM workflow_events").fetch_one(&pool).await.unwrap(), 0);
    search.acknowledge(&deletion).await.unwrap();
    let orphan = SearchDocument { text: String::new(), ..other_job.document };
    assert!(search.enqueue(&orphan).await.unwrap());
}

#[tokio::test]
async fn assignment_history_is_atomic_and_preferences_merge_independent_fields() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let initial = workflow("w");
    SqliteWorkflowStore::new(pool.clone()).insert(&initial, 0).await.unwrap();
    let assignments = SqliteAssignmentStore::new(pool.clone());
    let preferences = SqlitePreferencesStore::new(pool.clone());
    let desired = Assignments {
        stages: BTreeMap::from([(
            "first".into(),
            StageAssignment { accountable: Some("actor".into()), ..StageAssignment::default() },
        )]),
        tasks: BTreeMap::from([("z".into(), ["actor".into()].into_iter().collect())]),
        version: 1,
    };
    assert!(assignments.save(&initial.id, &desired, 0, &"missing".into(), 5).await.is_err());
    assert_eq!(assignments.find(&initial.id).await.unwrap(), Assignments::default());
    let actor_id = "actor".into();
    let (first, second) = tokio::join!(
        assignments.save(&initial.id, &desired, 0, &actor_id, 6),
        assignments.save(&initial.id, &desired, 0, &actor_id, 6),
    );
    assert!(matches!(
        (first, second),
        (Ok(()), Err(RepositoryError::VersionConflict { expected: 0 }))
            | (Err(RepositoryError::VersionConflict { expected: 0 }), Ok(()))
    ));
    assert_eq!(assignments.find(&initial.id).await.unwrap(), desired);
    assert_eq!(
        assignments.find_many(&[initial.id.clone(), "missing".into()]).await.unwrap(),
        BTreeMap::from([(initial.id.clone(), desired)])
    );
    let history =
        sqlx::query_as::<_, (i64, String, i64)>("SELECT version, changed_by, changed_at_ms FROM assignment_changes")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(history, [(1, "actor".into(), 6)]);

    let locale = WorkspacePreferences { locale: Some(Locale::En), ..WorkspacePreferences::default() };
    let theme = WorkspacePreferences {
        theme: Some(Theme::Dark),
        selected_task_id: Some("z".into()),
        ..WorkspacePreferences::default()
    };
    let (first, second) =
        tokio::join!(preferences.merge(&initial.id, &locale, 7), preferences.merge(&initial.id, &theme, 8));
    first.unwrap();
    second.unwrap();
    assert_eq!(
        preferences.find(&initial.id).await.unwrap(),
        WorkspacePreferences {
            locale: Some(Locale::En),
            theme: Some(Theme::Dark),
            view: None,
            selected_task_id: Some("z".into()),
        }
    );
}

#[tokio::test]
async fn sqlite_connect_creates_local_parent_directories() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("nested").join("path").join("store.sqlite3");
    let config = SqliteConfig { url: format!("sqlite://{}", path.display()) };
    connect(&config).await.unwrap().close().await;
    assert!(path.is_file());
}

#[tokio::test]
async fn sqlite_connect_supports_an_in_memory_database() {
    let pool = connect(&SqliteConfig { url: "sqlite::memory:".into() }).await.unwrap();
    let projects = SqliteProjectStore::new(pool);
    let project = project("memory");
    projects.insert(&project, None, 0).await.unwrap();
    assert_eq!(projects.find(&project.id).await.unwrap(), Some(project));
}

#[tokio::test]
async fn project_deletion_serializes_with_workflow_writes() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let projects = SqliteProjectStore::new(pool.clone());
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool.clone());
    let initial = workflow("w");
    workflows.insert(&initial, 0).await.unwrap();
    let (first, event) = change(&initial, "z", note("first"));
    workflows.update(&first, 0, &[event]).await.unwrap();
    let work_in_progress = search.pending(0, 1).await.unwrap().pop().unwrap();
    let mut archived = project("project");
    archived.archived = true;
    archived.version = 1;
    projects.update(&archived, 0, 1).await.unwrap();
    let (second, event) = change(&first, "z", note("second"));
    let (deletion, update) = tokio::join!(
        projects.delete_archived(&archived.id, 1),
        workflows.update(&second, 1, std::slice::from_ref(&event)),
    );
    deletion.unwrap();
    assert!(matches!(update, Ok(()) | Err(RepositoryError::VersionConflict { expected: 1 })));
    assert!(workflows.find(&initial.id).await.unwrap().is_none());
    assert!(search.current(&work_in_progress.document.key).await.unwrap().is_none());
    search.acknowledge(&work_in_progress).await.unwrap();
    let delete_job = search.pending(0, 10).await.unwrap().pop().unwrap();
    assert_eq!(delete_job.document.key, work_in_progress.document.key);
    assert!(delete_job.document.text.is_empty());
    assert!(delete_job.document.revision > work_in_progress.document.revision);
    let violations = sqlx::query("PRAGMA foreign_key_check").fetch_all(&pool).await.unwrap();
    assert!(violations.is_empty());
}

#[tokio::test]
async fn search_revision_changes_only_when_the_document_text_changes() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool);
    let initial = workflow("w");
    workflows.insert(&initial, 0).await.unwrap();
    let mut document = TaskDocument {
        version: 1,
        answers: BTreeMap::from([("a".into(), "Answer".into())]),
        review_status: process_flow_domain::workflow::ReviewStatus::Pending,
    };
    let record = TaskRecord { document: Some(document.clone()), ..TaskRecord::default() };
    let (first, event) = change(&initial, "z", record);
    workflows.update(&first, 0, &[event]).await.unwrap();
    let first_job = search.pending(0, 1).await.unwrap().pop().unwrap();
    search.acknowledge(&first_job).await.unwrap();

    document.review_status = process_flow_domain::workflow::ReviewStatus::Passed;
    let record = TaskRecord { document: Some(document), ..TaskRecord::default() };
    let (second, event) = change(&first, "z", record);
    workflows.update(&second, 1, &[event]).await.unwrap();
    assert_eq!(search.current(&first_job.document.key).await.unwrap(), Some(first_job.document));
    assert!(search.pending(0, 10).await.unwrap().is_empty());
    assert_eq!(workflows.find(&initial.id).await.unwrap(), Some(second));
}

#[tokio::test]
async fn stale_retry_does_not_change_the_job_backoff() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool);
    let mut workflow = workflow("w");
    workflow.state.records.insert("a".into(), note("alpha"));
    workflow.state.records.insert("b".into(), note("beta"));
    workflows.insert(&workflow, 0).await.unwrap();

    let first = search.pending(0, 1).await.unwrap().pop().unwrap();
    search.retry(&first, 100).await.unwrap();
    search.retry(&first, 1000).await.unwrap();
    let available = search.pending(0, 1).await.unwrap().pop().unwrap();
    assert_eq!(available.document.key.task_id.as_str(), "b");
    let due = search.pending(100, 10).await.unwrap();
    assert_eq!(due.len(), 2);
    assert_eq!(due[1].id, first.id);
    assert_eq!(due[1].attempts, 1);
}

#[tokio::test]
async fn failed_project_deletion_preserves_the_source_and_pending_upsert() {
    let db = Database::new();
    let pool = db.open().await;
    seed(&pool).await;
    let projects = SqliteProjectStore::new(pool.clone());
    let workflows = SqliteWorkflowStore::new(pool.clone());
    let search = SqliteSearchStore::new(pool.clone());
    let mut workflow = workflow("w");
    workflow.state.records.insert("z".into(), note("original"));
    workflows.insert(&workflow, 0).await.unwrap();
    let pending = search.pending(0, 1).await.unwrap().pop().unwrap();
    let mut archived = project("project");
    archived.archived = true;
    archived.version = 1;
    projects.update(&archived, 0, 1).await.unwrap();

    sqlx::query(
        "CREATE TRIGGER reject_deletion BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(projects.delete_archived(&archived.id, 1).await.is_err());
    assert_eq!(projects.find(&archived.id).await.unwrap(), Some(archived));
    assert_eq!(workflows.find(&workflow.id).await.unwrap(), Some(workflow));
    assert_eq!(search.current(&pending.document.key).await.unwrap(), Some(pending.document.clone()));
    assert_eq!(search.pending(0, 1).await.unwrap(), [pending]);
}

#[tokio::test]
async fn bootstrap_can_promote_an_existing_user_without_replacing_its_sessions() {
    let db = Database::new();
    let pool = db.open().await;
    let users = SqliteUserStore::new(pool.clone());
    let sessions = SqliteSessionStore::new(pool);
    let member = user("member");
    users.insert(&member, 0).await.unwrap();
    let session = Session { token_digest: "session".into(), user_id: member.id.clone(), expires_at_ms: 100 };
    sessions.insert(&session, 1).await.unwrap();
    users.put(&member.id, "old-hash", 2).await.unwrap();

    let admin = User { is_admin: true, version: 1, ..member };
    assert!(users.save_first_admin(&admin, "new-hash", 3).await.unwrap());
    assert_eq!(sessions.find_with_user("session").await.unwrap(), Some((session, Some(admin.clone()))));
    assert_eq!(CredentialRepository::find(&users, &admin.id).await.unwrap().as_deref(), Some("new-hash"));
}

#[tokio::test]
async fn assignments_report_a_missing_workflow_before_a_stale_version() {
    let db = Database::new();
    let pool = db.open().await;
    let assignments = SqliteAssignmentStore::new(pool);
    let changed = Assignments { version: 2, ..Assignments::default() };
    let result = assignments.save(&"deleted".into(), &changed, 1, &"actor".into(), 0).await;
    assert!(matches!(result, Err(RepositoryError::Backend(_))));
}

#[tokio::test]
async fn in_memory_pool_does_not_retire_its_only_connection() {
    for url in ["sqlite::memory:", "sqlite://named-memory?mode=memory"] {
        let pool = connect(&SqliteConfig { url: url.into() }).await.unwrap();
        assert_eq!(pool.options().get_max_connections(), 1);
        assert!(pool.options().get_max_lifetime().is_none(), "connection lifetime would destroy the memory database");
        assert!(pool.options().get_idle_timeout().is_none(), "idle expiry would destroy the memory database");
        assert!(!pool.options().get_test_before_acquire());
        pool.close().await;
    }
}
