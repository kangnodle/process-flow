use process_flow_runtime::{
    AssignmentService, AuthService, MembershipService, ProcessService, ProjectService, SearchService, UserService,
    WorkService, WorkflowService,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CookieSettings {
    pub secure: bool,
}

#[derive(Debug, Clone)]
pub struct ApiState {
    pub auth: AuthService,
    pub cookies: CookieSettings,
    pub processes: ProcessService,
    pub projects: ProjectService,
    pub users: UserService,
    pub memberships: MembershipService,
    pub assignments: AssignmentService,
    pub work: WorkService,
    pub workflows: WorkflowService,
    pub search: SearchService,
}
