use std::sync::Arc;

use process_flow_adapter_embedding::HashingEmbedder;
use process_flow_adapter_process_cache::CachedProcessRepository;
use process_flow_adapter_security::{Argon2Hasher, RandomTokens};
use process_flow_adapter_sqlite::{
    SqliteAssignmentStore, SqliteMembershipStore, SqlitePreferencesStore, SqliteProcessStore, SqliteProjectStore,
    SqliteSearchStore, SqliteSessionStore, SqliteUserStore, SqliteWorkflowStore,
};
use process_flow_adapter_system::{SystemClock, UuidGenerator};
use process_flow_api::{ApiState, CookieSettings};
use process_flow_application::ports::{Clock, Embedder, IdGenerator, PasswordHasher, ProcessRepository};
use process_flow_domain::process::standard::standard_spec;
use process_flow_runtime::{
    AssignmentService, AssignmentServiceDeps, AuthService, AuthServiceDeps, AuthSettings, MembershipService,
    ProcessService, ProjectAccess, ProjectService, SearchService, UserService, UserServiceDeps, WorkService,
    WorkServiceDeps, WorkflowService, WorkflowServiceDeps,
};

use crate::config::AppConfig;

use crate::storage::{SearchWorker, Storage};
use process_flow_adapter_lancedb::{LanceConfig, LanceRecordIndex};

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

pub async fn build_state(config: &AppConfig, storage: Storage) -> Result<(ApiState, SearchWorker), BoxError> {
    let db = storage.pool.clone();
    let process_graph = Arc::new(SqliteProcessStore::new(db.clone()));
    let process_store: Arc<dyn ProcessRepository> = Arc::new(CachedProcessRepository::new(process_graph.clone()));
    let project_store = Arc::new(SqliteProjectStore::new(db.clone()));
    let user_store = Arc::new(SqliteUserStore::new(db.clone()));
    let membership_store = Arc::new(SqliteMembershipStore::new(db.clone()));
    let workflow_store = Arc::new(SqliteWorkflowStore::new(db.clone()));
    let session_store = Arc::new(SqliteSessionStore::new(db.clone()));
    let assignment_store = Arc::new(SqliteAssignmentStore::new(db.clone()));
    let preferences_store = Arc::new(SqlitePreferencesStore::new(db.clone()));
    let source = Arc::new(SqliteSearchStore::new(db));
    let record_index = Arc::new(
        LanceRecordIndex::connect(&LanceConfig {
            uri: config.lancedb_uri.clone(),
            dimension: config.embedding_dimension,
        })
        .await?,
    );
    let embedder: Arc<dyn Embedder> = Arc::new(HashingEmbedder::new(config.embedding_dimension));

    let clock: Arc<dyn Clock> = Arc::new(SystemClock);
    let ids: Arc<dyn IdGenerator> = Arc::new(UuidGenerator);
    let hasher: Arc<dyn PasswordHasher> = Arc::new(Argon2Hasher);

    let auth = AuthService::new(
        AuthServiceDeps {
            users: user_store.clone(),
            credentials: user_store.clone(),
            sessions: session_store.clone(),
            hasher: hasher.clone(),
            tokens: Arc::new(RandomTokens),
            clock: clock.clone(),
            ids: ids.clone(),
        },
        AuthSettings {
            session_ttl_ms: i64::from(config.session_ttl_hours) * 60 * 60 * 1000,
            ..AuthSettings::default()
        },
    );

    let processes = ProcessService::new(process_store.clone(), process_graph);
    let access = ProjectAccess::new(membership_store.clone());
    let projects = ProjectService::new(project_store.clone(), access.clone(), clock.clone(), ids.clone());
    let users = UserService::new(UserServiceDeps {
        users: user_store.clone(),
        credentials: user_store.clone(),
        sessions: session_store,
        hasher,
        clock: clock.clone(),
        ids: ids.clone(),
    });
    let memberships = MembershipService::new(
        membership_store.clone(),
        user_store.clone(),
        project_store.clone(),
        workflow_store.clone(),
        assignment_store.clone(),
        clock.clone(),
    );
    let work = WorkService::new(WorkServiceDeps {
        memberships: membership_store.clone(),
        projects: project_store.clone(),
        workflows: workflow_store.clone(),
        processes: process_store.clone(),
        assignments: assignment_store.clone(),
    });
    let assignments = AssignmentService::new(AssignmentServiceDeps {
        projects: project_store.clone(),
        assignments: assignment_store.clone(),
        workflows: workflow_store.clone(),
        processes: process_store.clone(),
        memberships: membership_store,
        users: user_store,
        access: access.clone(),
        clock: clock.clone(),
    });
    let workflows = WorkflowService::new(WorkflowServiceDeps {
        workflows: workflow_store.clone(),
        processes: process_store.clone(),
        projects: project_store,
        access: access.clone(),
        assignments: assignment_store,
        preferences: preferences_store,
        clock: clock.clone(),
        ids,
    });
    let search = SearchService::new(record_index.clone(), source.clone(), embedder.clone(), workflow_store, access);

    let standard = processes.install(standard_spec()).await?;
    tracing::info!(process = %standard.id(), tasks = standard.task_count(), "표준 공정 준비 완료");
    if auth.setup_required().await? {
        tracing::warn!("관리자가 없습니다. 초기 설정이 열려 있어 처음 접속한 사람이 관리자가 됩니다");
    }

    let worker = SearchWorker::start(storage, source, record_index, embedder, clock);
    let cookies = CookieSettings { secure: config.cookie_secure };
    Ok((
        ApiState { auth, cookies, processes, projects, users, memberships, assignments, work, workflows, search },
        worker,
    ))
}
