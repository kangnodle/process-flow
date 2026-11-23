use std::sync::Arc;

use process_flow_application::ports::{Clock, Embedder, IdGenerator, PasswordHasher};
use process_flow_runtime::ProjectAccess;
use process_flow_runtime::{
    AssignmentService, AssignmentServiceDeps, AuthService, AuthServiceDeps, AuthSettings, MembershipService,
    ProcessService, ProjectService, SearchService, UserService, UserServiceDeps, WorkService, WorkServiceDeps,
    WorkflowService, WorkflowServiceDeps,
};

use crate::fakes::{FixedClock, LetterEmbedder, PlainHasher, SequentialIds, SequentialTokens};
use crate::store::InMemoryStore;

#[derive(Debug, Clone)]
pub struct InMemoryServices {
    pub store: Arc<InMemoryStore>,
    pub clock: Arc<FixedClock>,
    pub auth: AuthService,
    pub assignments: AssignmentService,
    pub work: WorkService,
    pub processes: ProcessService,
    pub projects: ProjectService,
    pub users: UserService,
    pub memberships: MembershipService,
    pub workflows: WorkflowService,
    pub search: SearchService,
}

pub fn in_memory_services() -> InMemoryServices {
    let store = Arc::new(InMemoryStore::default());
    let embedder: Arc<dyn Embedder> = Arc::new(LetterEmbedder);
    let fixed_clock = Arc::new(FixedClock::default());
    let clock: Arc<dyn Clock> = fixed_clock.clone();
    let hasher: Arc<dyn PasswordHasher> = Arc::new(PlainHasher);
    let access = ProjectAccess::new(store.clone());
    let ids: Arc<dyn IdGenerator> = Arc::new(SequentialIds::default());
    InMemoryServices {
        clock: fixed_clock,
        auth: AuthService::new(
            AuthServiceDeps {
                users: store.clone(),
                credentials: store.clone(),
                sessions: store.clone(),
                hasher: hasher.clone(),
                tokens: Arc::new(SequentialTokens::default()),
                clock: clock.clone(),
                ids: ids.clone(),
            },
            AuthSettings::default(),
        ),
        processes: ProcessService::new(store.clone(), store.clone()),
        projects: ProjectService::new(store.clone(), access.clone(), clock.clone(), ids.clone()),
        users: UserService::new(UserServiceDeps {
            users: store.clone(),
            credentials: store.clone(),
            sessions: store.clone(),
            hasher,
            clock: clock.clone(),
            ids: ids.clone(),
        }),
        memberships: MembershipService::new(
            store.clone(),
            store.clone(),
            store.clone(),
            store.clone(),
            store.clone(),
            clock.clone(),
        ),
        work: WorkService::new(WorkServiceDeps {
            memberships: store.clone(),
            projects: store.clone(),
            workflows: store.clone(),
            processes: store.clone(),
            assignments: store.clone(),
        }),
        assignments: AssignmentService::new(AssignmentServiceDeps {
            projects: store.clone(),
            assignments: store.clone(),
            workflows: store.clone(),
            processes: store.clone(),
            memberships: store.clone(),
            users: store.clone(),
            access: access.clone(),
            clock: clock.clone(),
        }),
        workflows: WorkflowService::new(WorkflowServiceDeps {
            workflows: store.clone(),
            processes: store.clone(),
            projects: store.clone(),
            access: access.clone(),
            assignments: store.clone(),
            preferences: store.clone(),
            clock,
            ids,
        }),
        search: SearchService::new(store.clone(), store.clone(), embedder, store.clone(), access),
        store,
    }
}

impl InMemoryServices {
    pub async fn index_pending(&self) {
        match process_flow_runtime::indexing::sync_search_jobs(
            self.store.as_ref(),
            self.store.as_ref(),
            self.store.as_ref(),
            &LetterEmbedder,
            self.clock.as_ref(),
        )
        .await
        {
            Ok(value) => value,
            Err(error) => panic!("expected process_flow_runtime::indexing::sync_search_jobs to succeed: {error:?}"),
        };
    }
}
