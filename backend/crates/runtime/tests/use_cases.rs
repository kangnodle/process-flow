use process_flow_application::ApplicationError;
use process_flow_domain::process::standard::{STANDARD_PROCESS_ID, standard_process, standard_spec};
use process_flow_domain::project::ProjectPatch;
use process_flow_domain::workflow::{Command, Event, Phase, Workflow};
use process_flow_domain::{ProcessId, ProjectId, RuleViolation, TaskId};
use process_flow_testing::{InMemoryServices, admin_actor, in_memory_services};

fn standard_id() -> ProcessId {
    STANDARD_PROCESS_ID.into()
}

async fn services() -> InMemoryServices {
    let services = in_memory_services();
    match services.processes.install(standard_spec()).await {
        Ok(value) => value,
        Err(error) => panic!("expected install to succeed: {error:?}"),
    };
    match services.projects.create_unowned("테스트 프로젝트", None).await {
        Ok(value) => value,
        Err(error) => panic!("expected create_unowned to succeed: {error:?}"),
    };
    services
}

async fn test_project(services: &InMemoryServices) -> ProjectId {
    let projects = match services.projects.list(&admin_actor(), true).await {
        Ok(value) => value,
        Err(error) => panic!("expected list to succeed: {error:?}"),
    };
    projects[0].project.id.clone()
}

async fn start(services: &InMemoryServices, name: Option<&str>) -> (Workflow, process_flow_domain::process::Process) {
    let project = test_project(services).await;
    let open = match services.workflows.start(&admin_actor(), &project, &standard_id(), name.map(Into::into)).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    };
    seed_documents(services, &open.workflow.id).await;
    (open.workflow, open.process)
}

async fn seed_documents(services: &InMemoryServices, id: &process_flow_domain::WorkflowId) {
    use process_flow_application::ports::WorkflowRepository;
    use process_flow_domain::workflow::{TaskDocument, TaskRecord, task_form};
    let mut workflow = match match WorkflowRepository::find(services.store.as_ref(), id).await {
        Ok(value) => value,
        Err(error) => panic!("expected WorkflowRepository::find to succeed: {error:?}"),
    } {
        Some(value) => value,
        None => panic!("expected returned value to be present"),
    };
    for task in standard_process().tasks() {
        workflow.state.records.insert(
            task.id.clone(),
            TaskRecord {
                document: Some(TaskDocument {
                    version: 1,
                    review_status: process_flow_domain::workflow::ReviewStatus::Passed,
                    answers: task_form(task.id.as_str())
                        .iter()
                        .map(|field| (field.id.to_owned(), "Verified requirement outcome".to_owned()))
                        .collect(),
                }),
                ..Default::default()
            },
        );
    }
    match WorkflowRepository::update(services.store.as_ref(), &workflow, workflow.version, &[]).await {
        Ok(value) => value,
        Err(error) => panic!("expected WorkflowRepository::update to succeed: {error:?}"),
    };
}

#[tokio::test]
async fn completing_planning_waits_for_approval_then_unlocks_design() {
    let services = services().await;
    let (workflow, process) = start(&services, Some("데모")).await;

    let planning: Vec<TaskId> = match process.stage(0) {
        Ok(value) => value,
        Err(error) => panic!("expected stage to succeed: {error:?}"),
    }
    .tasks
    .iter()
    .map(|t| t.id.clone())
    .collect();
    let mut last = None;
    for task_id in planning {
        last = Some(
            match services
                .workflows
                .execute(&admin_actor(), &workflow.id, Command::CompleteTask { task_id }, None)
                .await
            {
                Ok(value) => value,
                Err(error) => panic!("expected execute to succeed: {error:?}"),
            },
        );
    }
    let last = match last {
        Some(value) => value,
        None => panic!("expected last to be present"),
    };
    assert_eq!(last.workflow.state.phase, Phase::AwaitingApproval { stage_index: 0 });
    assert_eq!(last.workflow.version, 7);

    let approved = match services
        .workflows
        .execute(&admin_actor(), &workflow.id, Command::ApproveStage { stage_index: 0 }, Some(7))
        .await
    {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    assert_eq!(approved.workflow.state.phase, Phase::Working { stage_index: 1, completed: 0 });
    assert_eq!(approved.events, vec![Event::StageApproved { stage_index: 0 }]);
    assert_eq!(
        match services.store.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .len(),
        8
    );
}

#[tokio::test]
async fn rule_violation_and_stale_version_are_reported() {
    let services = services().await;
    let (workflow, _) = start(&services, None).await;

    let locked = services
        .workflows
        .execute(&admin_actor(), &workflow.id, Command::CompleteTask { task_id: "wireframes".into() }, None)
        .await;
    assert!(matches!(locked, Err(ApplicationError::Rule(RuleViolation::StageLocked { .. }))));

    let skipped = services
        .workflows
        .execute(&admin_actor(), &workflow.id, Command::CompleteTask { task_id: "constraints".into() }, None)
        .await;
    assert!(matches!(skipped, Err(ApplicationError::Rule(RuleViolation::OutOfOrder { .. }))));

    match services
        .workflows
        .execute(&admin_actor(), &workflow.id, Command::CompleteTask { task_id: "goals".into() }, Some(0))
        .await
    {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    let stale = services
        .workflows
        .execute(&admin_actor(), &workflow.id, Command::ReopenTask { task_id: "goals".into() }, Some(0))
        .await;
    assert!(matches!(stale, Err(ApplicationError::VersionConflict { expected: 0 })));
}

#[tokio::test]
async fn saved_changes_hide_previous_search_text_before_reindexing() {
    let services = services().await;
    let project = test_project(&services).await;
    let workflow = services.workflows.start(&admin_actor(), &project, &standard_id(), None).await.unwrap().workflow;
    let note = |text: &str| Command::UpdateRecord {
        task_id: "goals".into(),
        link: None,
        note: Some(text.into()),
        document: None,
        evidence: None,
    };
    services.workflows.execute(&admin_actor(), &workflow.id, note("kpi original"), None).await.unwrap();
    services.index_pending().await;
    let before = services.search.search(&admin_actor(), "kpi", Some(&workflow.id), 5).await.unwrap();
    assert_eq!(before[0].text, "kpi original");
    services.workflows.execute(&admin_actor(), &workflow.id, note("new objective"), None).await.unwrap();
    let during = services.search.search(&admin_actor(), "kpi", Some(&workflow.id), 5).await.unwrap();
    assert!(during.is_empty());
    services.index_pending().await;
    let after = services.search.search(&admin_actor(), "objective", Some(&workflow.id), 5).await.unwrap();
    assert_eq!(after[0].text, "new objective");
}

#[tokio::test]
async fn records_are_indexed_and_searchable() {
    let services = services().await;
    let project = test_project(&services).await;
    let workflow = match services.workflows.start(&admin_actor(), &project, &standard_id(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    }
    .workflow;
    let note = |task: &str, text: &str| Command::UpdateRecord {
        task_id: task.into(),
        link: None,
        note: Some(text.into()),
        document: None,
        evidence: None,
    };

    match services.workflows.execute(&admin_actor(), &workflow.id, note("goals", "kpi kpi kpi"), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    match services
        .workflows
        .execute(&admin_actor(), &workflow.id, note("constraints", "zzz wireframe sketch"), None)
        .await
    {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };

    services.index_pending().await;
    let hits = match services.search.search(&admin_actor(), "kpi", Some(&workflow.id), 5).await {
        Ok(value) => value,
        Err(error) => panic!("expected search to succeed: {error:?}"),
    };
    assert_eq!(hits.first().map(|h| h.task_id.as_str()), Some("goals"));

    match services.workflows.execute(&admin_actor(), &workflow.id, note("goals", ""), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    services.index_pending().await;
    let hits = match services.search.search(&admin_actor(), "kpi", Some(&workflow.id), 5).await {
        Ok(value) => value,
        Err(error) => panic!("expected search to succeed: {error:?}"),
    };
    assert!(hits.iter().all(|h| h.task_id.as_str() != "goals"));
}

#[tokio::test]
async fn prerequisites_validate_task() {
    let services = in_memory_services();
    match services.processes.install(standard_spec()).await {
        Ok(value) => value,
        Err(error) => panic!("expected install to succeed: {error:?}"),
    };
    let before = match services.processes.prerequisites(&standard_id(), &"dev-environment".into()).await {
        Ok(value) => value,
        Err(error) => panic!("expected prerequisites to succeed: {error:?}"),
    };
    assert_eq!(before.len(), 13);
    let missing = services.processes.prerequisites(&standard_id(), &"nope".into()).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })));
}

#[tokio::test]
async fn rework_rewinds_and_requires_a_reason() {
    let services = services().await;
    let (workflow, process) = start(&services, None).await;
    for task in &match process.stage(0) {
        Ok(value) => value,
        Err(error) => panic!("expected stage to succeed: {error:?}"),
    }
    .tasks[..3]
    {
        let command = Command::CompleteTask { task_id: task.id.clone() };
        match services.workflows.execute(&admin_actor(), &workflow.id, command, None).await {
            Ok(value) => value,
            Err(error) => panic!("expected execute to succeed: {error:?}"),
        };
    }

    let empty = Command::RequestRework { task_id: "goals".into(), reason: " ".into() };
    let rejected = services.workflows.execute(&admin_actor(), &workflow.id, empty, None).await;
    assert!(matches!(rejected, Err(ApplicationError::Rule(RuleViolation::ReworkReasonRequired))));

    let request = Command::RequestRework { task_id: "user-research".into(), reason: "인터뷰 대상 누락".into() };
    let outcome = match services.workflows.execute(&admin_actor(), &workflow.id, request, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    assert_eq!(outcome.workflow.state.phase, Phase::Working { stage_index: 0, completed: 1 });
    assert_eq!(outcome.workflow.state.rework.as_ref().map(|r| r.until_number), Some(4));
    let reloaded = match services.workflows.get(&admin_actor(), &workflow.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected get to succeed: {error:?}"),
    }
    .workflow;
    assert_eq!(reloaded.state, outcome.workflow.state);
}

#[tokio::test]
async fn projects_are_created_updated_and_archived() {
    let empty = in_memory_services();
    assert!(
        match empty.projects.list(&admin_actor(), true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .is_empty()
    );

    let services = services().await;
    assert_eq!(
        match services.projects.list(&admin_actor(), false).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );

    let invalid = services.projects.create_unowned("  ", None).await;
    assert!(matches!(invalid, Err(ApplicationError::Invalid(_))), "{invalid:?}");

    let project = match services.projects.create_unowned(" 결제 개편 ", Some("2분기")).await {
        Ok(value) => value,
        Err(error) => panic!("expected create_unowned to succeed: {error:?}"),
    };
    assert_eq!(project.name, "결제 개편");
    assert_eq!(
        match services.projects.get(&admin_actor(), &project.id).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .project,
        project
    );

    let rename = ProjectPatch { name: Some("결제 2.0".into()), ..Default::default() };
    let renamed = match services.projects.update(&admin_actor(), &project.id, &rename, Some(0)).await {
        Ok(value) => value,
        Err(error) => panic!("expected update to succeed: {error:?}"),
    }
    .project;
    assert_eq!((renamed.name.as_str(), renamed.version), ("결제 2.0", 1));
    let same = match services.projects.update(&admin_actor(), &project.id, &rename, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected update to succeed: {error:?}"),
    }
    .project;
    assert_eq!(same.version, 1);
    let stale = services.projects.update(&admin_actor(), &project.id, &rename, Some(0)).await;
    assert!(matches!(stale, Err(ApplicationError::VersionConflict { expected: 0 })), "{stale:?}");

    assert!(matches!(
        services.projects.delete_archived(&admin_actor(), &project.id, renamed.version).await,
        Err(ApplicationError::Conflict(_))
    ));
    let archived = match services.projects.archive(&admin_actor(), &project.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected archive to succeed: {error:?}"),
    }
    .project;
    assert!(archived.archived);
    assert_eq!(
        match services.projects.list(&admin_actor(), false).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    assert_eq!(
        match services.projects.list(&admin_actor(), true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        2
    );
    assert!(matches!(
        services.projects.delete_archived(&admin_actor(), &project.id, renamed.version).await,
        Err(ApplicationError::VersionConflict { .. })
    ));
    match services.projects.delete_archived(&admin_actor(), &project.id, archived.version).await {
        Ok(value) => value,
        Err(error) => panic!("expected delete_archived to succeed: {error:?}"),
    };
    assert!(services.projects.get(&admin_actor(), &project.id).await.is_err());

    let first = test_project(&services).await;
    assert!(
        match services.projects.archive(&admin_actor(), &first).await {
            Ok(value) => value,
            Err(error) => panic!("expected archive to succeed: {error:?}"),
        }
        .project
        .archived
    );
    let missing = services.projects.get(&admin_actor(), &"nope".into()).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
}

#[tokio::test]
async fn workflows_belong_to_a_project() {
    let services = services().await;
    let project = match services.projects.create_unowned("결제 개편", None).await {
        Ok(value) => value,
        Err(error) => panic!("expected create_unowned to succeed: {error:?}"),
    };
    let in_project = match services.workflows.start(&admin_actor(), &project.id, &standard_id(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    }
    .workflow;
    seed_documents(&services, &in_project.id).await;
    let (in_other, _) = start(&services, Some("다른")).await;
    assert_eq!(in_project.project_id, project.id);
    assert_eq!(in_project.name, "새 워크플로");

    let listed = match services.workflows.list(&admin_actor(), Some(&project.id)).await {
        Ok(value) => value,
        Err(error) => panic!("expected list to succeed: {error:?}"),
    };
    assert_eq!(listed.iter().map(|w| &w.id).collect::<Vec<_>>(), vec![&in_project.id]);
    assert_eq!(
        match services.workflows.list(&admin_actor(), None).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        2
    );
    let other = test_project(&services).await;
    assert_eq!(
        match services.workflows.list(&admin_actor(), Some(&other)).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }[0]
        .id,
        in_other.id
    );

    let missing = services.workflows.start(&admin_actor(), &"nope".into(), &standard_id(), None).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
    let missing = services.workflows.list(&admin_actor(), Some(&"nope".into())).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");

    match services.projects.archive(&admin_actor(), &project.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected archive to succeed: {error:?}"),
    };
    let archived = services.workflows.start(&admin_actor(), &project.id, &standard_id(), None).await;
    assert!(matches!(archived, Err(ApplicationError::Conflict(_))), "{archived:?}");
    let command = Command::CompleteTask { task_id: "goals".into() };
    let blocked = services.workflows.execute(&admin_actor(), &in_project.id, command, None).await;
    assert!(matches!(blocked, Err(ApplicationError::Forbidden(_))), "{blocked:?}");
}

#[tokio::test]
async fn users_are_created_updated_and_deactivated() {
    use process_flow_domain::user::UserPatch;
    let services = services().await;

    let kim = match services.users.create(&admin_actor(), " Kim@Example.com ", "김개발", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    assert_eq!(kim.email, "kim@example.com");
    let invalid = services.users.create(&admin_actor(), "nope", "이름", "password1").await;
    assert!(matches!(invalid, Err(ApplicationError::Invalid(_))), "{invalid:?}");
    let duplicate = services.users.create(&admin_actor(), "KIM@example.com", "다른 사람", "password1").await;
    assert!(matches!(duplicate, Err(ApplicationError::Conflict(_))), "{duplicate:?}");

    let lee = match services.users.create(&admin_actor(), "lee@example.com", "이디자인", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    let taken = UserPatch { email: Some("kim@example.com".into()), ..Default::default() };
    let clash = services.users.update(&admin_actor(), &lee.id, &taken, None).await;
    assert!(matches!(clash, Err(ApplicationError::Conflict(_))), "{clash:?}");

    let rename = UserPatch { name: Some("이디자이너".into()), ..Default::default() };
    let renamed = match services.users.update(&admin_actor(), &lee.id, &rename, Some(0)).await {
        Ok(value) => value,
        Err(error) => panic!("expected update to succeed: {error:?}"),
    };
    assert_eq!((renamed.name.as_str(), renamed.version), ("이디자이너", 1));
    let stale = services.users.update(&admin_actor(), &lee.id, &rename, Some(0)).await;
    assert!(matches!(stale, Err(ApplicationError::VersionConflict { expected: 0 })), "{stale:?}");

    match services.users.deactivate(&admin_actor(), &lee.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected deactivate to succeed: {error:?}"),
    };
    assert_eq!(
        match services.users.list(false).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    assert_eq!(
        match services.users.list(true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        2
    );
    let missing = services.users.get(&"nope".into()).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
}

#[tokio::test]
async fn memberships_keep_the_last_owner() {
    use process_flow_domain::membership::Role;
    let services = services().await;
    let project = match services.projects.create_unowned("결제 개편", None).await {
        Ok(value) => value,
        Err(error) => panic!("expected create_unowned to succeed: {error:?}"),
    };
    let kim = match services.users.create(&admin_actor(), "kim@example.com", "김개발", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    let lee = match services.users.create(&admin_actor(), "lee@example.com", "이디자인", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };

    assert!(
        match services.memberships.members(&admin_actor(), &project.id).await {
            Ok(value) => value,
            Err(error) => panic!("expected members to succeed: {error:?}"),
        }
        .is_empty()
    );
    match services.memberships.put(&admin_actor(), &project.id, &kim.id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    match services.memberships.put(&admin_actor(), &project.id, &lee.id, Role::Viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    let promoted = match services.memberships.put(&admin_actor(), &project.id, &lee.id, Role::Editor).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert_eq!(promoted.role, Role::Editor);
    let members = match services.memberships.members(&admin_actor(), &project.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected members to succeed: {error:?}"),
    };
    assert_eq!(
        members.iter().map(|m| (m.user.name.as_str(), m.role)).collect::<Vec<_>>(),
        vec![("김개발", Role::Owner), ("이디자인", Role::Editor)]
    );

    let leave = services.memberships.remove(&admin_actor(), &project.id, &kim.id).await;
    assert!(matches!(leave, Err(ApplicationError::Conflict(_))), "{leave:?}");
    let demote = services.memberships.put(&admin_actor(), &project.id, &kim.id, Role::Viewer).await;
    assert!(matches!(demote, Err(ApplicationError::Conflict(_))), "{demote:?}");
    match services.memberships.put(&admin_actor(), &project.id, &lee.id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    match services.memberships.remove(&admin_actor(), &project.id, &kim.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected remove to succeed: {error:?}"),
    };
    let again = services.memberships.remove(&admin_actor(), &project.id, &kim.id).await;
    assert!(matches!(again, Err(ApplicationError::NotFound { .. })), "{again:?}");

    let of_lee = match services.memberships.projects_of(&admin_actor(), &lee.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected projects_of to succeed: {error:?}"),
    };
    assert_eq!(
        of_lee.iter().map(|e| (e.project.id.clone(), e.role)).collect::<Vec<_>>(),
        vec![(project.id.clone(), Role::Owner)]
    );
    assert!(
        match services.memberships.projects_of(&admin_actor(), &kim.id).await {
            Ok(value) => value,
            Err(error) => panic!("expected projects_of to succeed: {error:?}"),
        }
        .is_empty()
    );

    match services.users.deactivate(&admin_actor(), &kim.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected deactivate to succeed: {error:?}"),
    };
    let inactive = services.memberships.put(&admin_actor(), &project.id, &kim.id, Role::Viewer).await;
    assert!(matches!(inactive, Err(ApplicationError::Conflict(_))), "{inactive:?}");
    match services.memberships.put(&admin_actor(), &project.id, &lee.id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };

    let missing = services.memberships.put(&admin_actor(), &"nope".into(), &lee.id, Role::Viewer).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
    let missing = services.memberships.put(&admin_actor(), &project.id, &"nope".into(), Role::Viewer).await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
}

#[tokio::test]
async fn setup_creates_the_first_admin_once() {
    let services = in_memory_services();
    assert!(match services.auth.setup_required().await {
        Ok(value) => value,
        Err(error) => panic!("expected setup_required to succeed: {error:?}"),
    });
    let short = services.auth.setup("root@example.com", "관리자", "short").await;
    assert!(matches!(short, Err(ApplicationError::Invalid(_))), "{short:?}");

    let grant = match services.auth.setup(" Root@Example.com ", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    assert!(grant.user.is_admin);
    assert_eq!(grant.user.email, "root@example.com");
    assert!(!match services.auth.setup_required().await {
        Ok(value) => value,
        Err(error) => panic!("expected setup_required to succeed: {error:?}"),
    });
    assert_eq!(
        match services.auth.authenticate(&grant.token).await {
            Ok(value) => value,
            Err(error) => panic!("expected authenticate to succeed: {error:?}"),
        }
        .user,
        grant.user
    );

    let again = services.auth.setup("other@example.com", "다른 사람", "password1").await;
    assert!(matches!(again, Err(ApplicationError::Conflict(_))), "{again:?}");
    assert_eq!(
        match services.users.list(true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
}

#[tokio::test]
async fn setup_promotes_a_user_created_before_authentication() {
    use process_flow_application::ports::UserRepository;
    use process_flow_domain::user::User;
    let services = in_memory_services();
    let legacy = match User::create("legacy".into(), "kim@example.com", "김개발") {
        Ok(value) => value,
        Err(error) => panic!("expected User::create to succeed: {error:?}"),
    };
    match services.store.insert(&legacy, 1).await {
        Ok(value) => value,
        Err(error) => panic!("expected insert to succeed: {error:?}"),
    };
    assert!(match services.auth.setup_required().await {
        Ok(value) => value,
        Err(error) => panic!("expected setup_required to succeed: {error:?}"),
    });
    let no_password = services.auth.login("kim@example.com", "password1").await;
    assert!(matches!(no_password, Err(ApplicationError::InvalidCredentials)), "{no_password:?}");

    let grant = match services.auth.setup("KIM@example.com", "김관리", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    assert_eq!((grant.user.id.as_str(), grant.user.name.as_str(), grant.user.is_admin), ("legacy", "김관리", true));
    assert_eq!(
        match services.users.list(true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    match services.auth.login("kim@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
}

#[tokio::test]
async fn login_sessions_expire_slide_and_end() {
    const HOUR: i64 = 60 * 60 * 1000;
    let services = in_memory_services();
    let admin = match services.auth.setup("root@example.com", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    let ttl = services.auth.session_ttl_ms();

    for (email, password) in [("root@example.com", "wrong-password"), ("nobody@example.com", "password1"), ("x", "y")] {
        let failed = services.auth.login(email, password).await;
        assert!(matches!(failed, Err(ApplicationError::InvalidCredentials)), "{email}: {failed:?}");
    }
    let grant = match services.auth.login("ROOT@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    assert_ne!(grant.token, admin.token);
    assert!(
        match services.store.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .iter()
        .all(|s| s.token_digest != grant.token)
    );
    let unknown = services.auth.authenticate("nope").await;
    assert!(matches!(unknown, Err(ApplicationError::Unauthenticated)), "{unknown:?}");

    assert_eq!(
        match services.auth.authenticate(&grant.token).await {
            Ok(value) => value,
            Err(error) => panic!("expected authenticate to succeed: {error:?}"),
        }
        .renewed_until_ms,
        None
    );
    services.clock.advance(2 * HOUR);
    let renewed = match services.auth.authenticate(&grant.token).await {
        Ok(value) => value,
        Err(error) => panic!("expected authenticate to succeed: {error:?}"),
    }
    .renewed_until_ms;
    assert_eq!(renewed, Some(grant.expires_at_ms + 2 * HOUR));
    services.clock.advance(ttl);
    let expired = services.auth.authenticate(&grant.token).await;
    assert!(matches!(expired, Err(ApplicationError::Unauthenticated)), "{expired:?}");

    let fresh = match services.auth.login("root@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    assert_eq!(
        match services.store.sessions.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .len(),
        1
    );
    match services.auth.logout(&fresh.token).await {
        Ok(value) => value,
        Err(error) => panic!("expected logout to succeed: {error:?}"),
    };
    match services.auth.logout(&fresh.token).await {
        Ok(value) => value,
        Err(error) => panic!("expected logout to succeed: {error:?}"),
    };
    assert!(matches!(services.auth.authenticate(&fresh.token).await, Err(ApplicationError::Unauthenticated)));
}

#[tokio::test]
async fn repeated_login_failures_are_throttled_for_a_while() {
    let services = in_memory_services();
    match services.auth.setup("root@example.com", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    for _ in 0..10 {
        let failed = services.auth.login("root@example.com", "wrong-password").await;
        assert!(matches!(failed, Err(ApplicationError::InvalidCredentials)), "{failed:?}");
    }
    let blocked = services.auth.login("root@example.com", "password1").await;
    assert!(matches!(blocked, Err(ApplicationError::TooManyAttempts)), "{blocked:?}");
    let other = services.auth.login("other@example.com", "password1").await;
    assert!(matches!(other, Err(ApplicationError::InvalidCredentials)), "{other:?}");

    services.clock.advance(15 * 60 * 1000);
    match services.auth.login("root@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
}

#[tokio::test]
async fn only_admins_manage_users_and_the_last_admin_stays() {
    use process_flow_domain::user::UserPatch;
    let services = in_memory_services();
    let root = match services.auth.setup("root@example.com", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    let admin = root.user.actor();

    let weak = services.users.create(&admin, "kim@example.com", "김개발", "short").await;
    assert!(matches!(weak, Err(ApplicationError::Invalid(_))), "{weak:?}");
    let kim = match services.users.create(&admin, "kim@example.com", "김개발", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    let kim_session = match services.auth.login("kim@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    let member = kim_session.user.actor();
    assert!(!member.is_admin);

    let rename = UserPatch { name: Some("김".into()), ..Default::default() };
    let forbidden = [
        services.users.create(&member, "lee@example.com", "이디자인", "password1").await.err(),
        services.users.update(&member, &kim.id, &rename, None).await.err(),
        services.users.deactivate(&member, &root.user.id).await.err(),
        services.users.set_password(&member, &root.user.id, "password2").await.err(),
    ];
    for error in forbidden {
        assert!(matches!(error, Some(ApplicationError::Forbidden(_))), "{error:?}");
    }
    assert_eq!(
        match services.users.list(true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        2
    );

    let demote = UserPatch { is_admin: Some(false), ..Default::default() };
    let last = services.users.update(&admin, &root.user.id, &demote, None).await;
    assert!(matches!(last, Err(ApplicationError::Conflict(_))), "{last:?}");
    let last = services.users.deactivate(&admin, &root.user.id).await;
    assert!(matches!(last, Err(ApplicationError::Conflict(_))), "{last:?}");
    let promote = UserPatch { is_admin: Some(true), ..Default::default() };
    match services.users.update(&admin, &kim.id, &promote, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected update to succeed: {error:?}"),
    };
    assert!(
        match services.auth.authenticate(&kim_session.token).await {
            Ok(value) => value,
            Err(error) => panic!("expected authenticate to succeed: {error:?}"),
        }
        .actor()
        .is_admin
    );
    match services.users.update(&admin, &root.user.id, &demote, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected update to succeed: {error:?}"),
    };

    let kim_admin = match services.auth.authenticate(&kim_session.token).await {
        Ok(value) => value,
        Err(error) => panic!("expected authenticate to succeed: {error:?}"),
    }
    .actor();
    match services.users.deactivate(&kim_admin, &root.user.id).await {
        Ok(value) => value,
        Err(error) => panic!("expected deactivate to succeed: {error:?}"),
    };
    assert!(matches!(services.auth.authenticate(&root.token).await, Err(ApplicationError::Unauthenticated)));
    let inactive = services.auth.login("root@example.com", "password1").await;
    assert!(matches!(inactive, Err(ApplicationError::InvalidCredentials)), "{inactive:?}");
}

#[tokio::test]
async fn passwords_are_changed_by_the_user_or_set_by_an_admin() {
    let services = in_memory_services();
    let root = match services.auth.setup("root@example.com", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    let admin = root.user.actor();
    let kim = match services.users.create(&admin, "kim@example.com", "김개발", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    let first = match services.auth.login("kim@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    let second = match services.auth.login("kim@example.com", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    let actor = first.user.actor();

    let wrong = services.auth.change_password(&actor, &first.token, "wrong-password", "password2").await;
    assert!(matches!(wrong, Err(ApplicationError::Invalid(_))), "{wrong:?}");
    let weak = services.auth.change_password(&actor, &first.token, "password1", "short").await;
    assert!(matches!(weak, Err(ApplicationError::Invalid(_))), "{weak:?}");

    match services.auth.change_password(&actor, &first.token, "password1", "password2").await {
        Ok(value) => value,
        Err(error) => panic!("expected change_password to succeed: {error:?}"),
    };
    match services.auth.authenticate(&first.token).await {
        Ok(value) => value,
        Err(error) => panic!("expected authenticate to succeed: {error:?}"),
    };
    assert!(matches!(services.auth.authenticate(&second.token).await, Err(ApplicationError::Unauthenticated)));
    assert!(matches!(
        services.auth.login("kim@example.com", "password1").await,
        Err(ApplicationError::InvalidCredentials)
    ));
    match services.auth.login("kim@example.com", "password2").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };

    match services.users.set_password(&admin, &kim.id, "password3").await {
        Ok(value) => value,
        Err(error) => panic!("expected set_password to succeed: {error:?}"),
    };
    assert!(matches!(services.auth.authenticate(&first.token).await, Err(ApplicationError::Unauthenticated)));
    match services.auth.login("kim@example.com", "password3").await {
        Ok(value) => value,
        Err(error) => panic!("expected login to succeed: {error:?}"),
    };
    let missing = services.users.set_password(&admin, &"nope".into(), "password3").await;
    assert!(matches!(missing, Err(ApplicationError::NotFound { .. })), "{missing:?}");
}

struct Team {
    services: InMemoryServices,
    project: ProjectId,
    owner: process_flow_domain::user::Actor,
    editor: process_flow_domain::user::Actor,
    viewer: process_flow_domain::user::Actor,
    outsider: process_flow_domain::user::Actor,
}

async fn team() -> Team {
    use process_flow_domain::membership::Role;
    let services = in_memory_services();
    match services.processes.install(standard_spec()).await {
        Ok(value) => value,
        Err(error) => panic!("expected install to succeed: {error:?}"),
    };
    let admin = match services.auth.setup("root@example.com", "관리자", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    }
    .user
    .actor();
    let mut actors = Vec::new();
    for name in ["owner", "editor", "viewer", "outsider"] {
        let user = match services.users.create(&admin, &format!("{name}@example.com"), name, "password1").await {
            Ok(value) => value,
            Err(error) => panic!("expected create to succeed: {error:?}"),
        };
        actors.push(user.actor());
    }
    let [owner, editor, viewer, outsider]: [_; 4] = match actors.try_into() {
        Ok(value) => value,
        Err(error) => panic!("expected try_into to succeed: {error:?}"),
    };
    let created = match services.projects.create(&owner, "결제 개편", None).await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    };
    assert_eq!(created.role, Role::Owner);
    let project = created.project.id;
    match services.memberships.put(&owner, &project, &editor.user_id, Role::Editor).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    match services.memberships.put(&owner, &project, &viewer.user_id, Role::Viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    Team { services, project, owner, editor, viewer, outsider }
}

fn is_forbidden<T: std::fmt::Debug>(result: &Result<T, ApplicationError>) -> bool {
    matches!(result, Err(ApplicationError::Forbidden(_)))
}

fn is_hidden<T: std::fmt::Debug>(result: &Result<T, ApplicationError>) -> bool {
    matches!(result, Err(ApplicationError::NotFound { .. }))
}

#[tokio::test]
async fn project_creator_becomes_owner_and_others_do_not_see_it() {
    use process_flow_domain::membership::Role;
    let Team { services, project, owner, editor, viewer, outsider } = team().await;

    let members = match services.memberships.members(&viewer, &project).await {
        Ok(value) => value,
        Err(error) => panic!("expected members to succeed: {error:?}"),
    };
    assert_eq!(
        members.iter().map(|m| (m.user.name.as_str(), m.role)).collect::<Vec<_>>(),
        vec![("owner", Role::Owner), ("editor", Role::Editor), ("viewer", Role::Viewer)]
    );
    for (actor, role) in [(&owner, Role::Owner), (&editor, Role::Editor), (&viewer, Role::Viewer)] {
        let listed = match services.projects.list(actor, true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        };
        assert_eq!(listed.iter().map(|p| (&p.project.id, p.role)).collect::<Vec<_>>(), vec![(&project, role)]);
        assert_eq!(
            match services.projects.get(actor, &project).await {
                Ok(value) => value,
                Err(error) => panic!("expected get to succeed: {error:?}"),
            }
            .role,
            role
        );
    }

    assert!(
        match services.projects.list(&outsider, true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .is_empty()
    );
    let hidden = services.projects.get(&outsider, &project).await.unwrap_err().to_string();
    let missing = services.projects.get(&outsider, &"nope".into()).await.unwrap_err().to_string();
    assert_eq!(hidden.replace(project.as_str(), "nope"), missing);
    assert!(is_hidden(&services.memberships.members(&outsider, &project).await));
    assert!(is_hidden(&services.workflows.list(&outsider, Some(&project)).await));
    assert!(is_hidden(&services.workflows.start(&outsider, &project, &standard_id(), None).await));
    assert!(is_hidden(&services.projects.archive(&outsider, &project).await));
    assert!(is_hidden(&services.memberships.put(&outsider, &project, &outsider.user_id, Role::Owner).await));
}

#[tokio::test]
async fn only_owners_edit_projects_and_manage_members() {
    use process_flow_domain::membership::Role;
    let Team { services, project, owner, editor, viewer, outsider } = team().await;
    let rename = ProjectPatch { name: Some("결제 2.0".into()), ..Default::default() };

    for actor in [&editor, &viewer] {
        assert!(is_forbidden(&services.projects.update(actor, &project, &rename, None).await));
        assert!(is_forbidden(&services.projects.archive(actor, &project).await));
        assert!(is_forbidden(&services.memberships.put(actor, &project, &outsider.user_id, Role::Viewer).await));
        assert!(is_forbidden(&services.memberships.put(actor, &project, &actor.user_id, Role::Owner).await));
        assert!(is_forbidden(&services.memberships.remove(actor, &project, &owner.user_id).await));
    }
    assert_eq!(
        match services.projects.get(&owner, &project).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .project
        .name,
        "결제 개편"
    );

    assert_eq!(
        match services.projects.update(&owner, &project, &rename, None).await {
            Ok(value) => value,
            Err(error) => panic!("expected update to succeed: {error:?}"),
        }
        .project
        .name,
        "결제 2.0"
    );
    match services.memberships.put(&owner, &project, &outsider.user_id, Role::Viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert_eq!(
        match services.projects.list(&outsider, true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    match services.memberships.remove(&owner, &project, &outsider.user_id).await {
        Ok(value) => value,
        Err(error) => panic!("expected remove to succeed: {error:?}"),
    };
    assert!(is_hidden(&services.projects.get(&outsider, &project).await));

    match services.memberships.put(&owner, &project, &editor.user_id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    match services.projects.archive(&editor, &project).await {
        Ok(value) => value,
        Err(error) => panic!("expected archive to succeed: {error:?}"),
    };

    assert_eq!(
        match services.memberships.projects_of(&viewer, &viewer.user_id).await {
            Ok(value) => value,
            Err(error) => panic!("expected projects_of to succeed: {error:?}"),
        }
        .len(),
        1
    );
    assert_eq!(
        match services.memberships.projects_of(&admin_actor(), &viewer.user_id).await {
            Ok(value) => value,
            Err(error) => panic!("expected projects_of to succeed: {error:?}"),
        }
        .len(),
        1
    );
    assert!(is_forbidden(&services.memberships.projects_of(&viewer, &owner.user_id).await));
}

#[tokio::test]
async fn editors_run_workflows_and_viewers_only_read() {
    let Team { services, project, owner, editor, viewer, outsider } = team().await;
    let complete = || Command::CompleteTask { task_id: "goals".into() };
    let theme = || process_flow_application::WorkspacePreferences {
        theme: Some(process_flow_application::preferences::Theme::Dark),
        ..Default::default()
    };

    assert!(is_forbidden(&services.workflows.start(&viewer, &project, &standard_id(), None).await));
    let started = match services.workflows.start(&editor, &project, &standard_id(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    };
    assert_eq!(started.role, process_flow_domain::membership::Role::Editor);
    let id = started.workflow.id;
    seed_documents(&services, &id).await;

    assert_eq!(
        match services.workflows.get(&viewer, &id).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .role,
        process_flow_domain::membership::Role::Viewer
    );
    assert_eq!(
        match services.workflows.list(&viewer, None).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    match services.workflows.preferences(&viewer, &id).await {
        Ok(value) => value,
        Err(error) => panic!("expected preferences to succeed: {error:?}"),
    };
    assert!(is_forbidden(&services.workflows.execute(&viewer, &id, complete(), None).await));
    assert!(is_forbidden(&services.workflows.update_preferences(&viewer, &id, theme()).await));
    assert!(
        match services.store.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .is_empty()
    );

    match services.workflows.execute(&editor, &id, complete(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    let approve = Command::UpdateRecord {
        task_id: "user-research".into(),
        link: None,
        note: Some("kpi kpi".into()),
        document: None,
        evidence: None,
    };
    match services.workflows.execute(&owner, &id, approve, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    match services.workflows.update_preferences(&editor, &id, theme()).await {
        Ok(value) => value,
        Err(error) => panic!("expected update_preferences to succeed: {error:?}"),
    };
    let actors: Vec<_> = match services.store.events.lock() {
        Ok(value) => value,
        Err(error) => panic!("expected lock to succeed: {error:?}"),
    }
    .iter()
    .map(|e| e.actor.clone())
    .collect();
    assert_eq!(actors, vec![editor.user_id.clone(), owner.user_id.clone()]);

    assert!(is_hidden(&services.workflows.get(&outsider, &id).await));
    assert!(is_hidden(&services.workflows.execute(&outsider, &id, complete(), None).await));
    assert!(is_hidden(&services.workflows.preferences(&outsider, &id).await));
    assert!(
        match services.workflows.list(&outsider, None).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .is_empty()
    );

    services.index_pending().await;
    assert_eq!(
        match services.search.search(&viewer, "kpi", None, 5).await {
            Ok(value) => value,
            Err(error) => panic!("expected search to succeed: {error:?}"),
        }
        .len(),
        1
    );
    services.index_pending().await;
    assert_eq!(
        match services.search.search(&viewer, "kpi", Some(&id), 5).await {
            Ok(value) => value,
            Err(error) => panic!("expected search to succeed: {error:?}"),
        }
        .len(),
        1
    );
    assert!(
        match services.search.search(&outsider, "kpi", None, 5).await {
            Ok(value) => value,
            Err(error) => panic!("expected search to succeed: {error:?}"),
        }
        .is_empty()
    );
    assert!(is_hidden(&services.search.search(&outsider, "kpi", Some(&id), 5).await));
    assert_eq!(
        match services.search.search(&admin_actor(), "kpi", None, 5).await {
            Ok(value) => value,
            Err(error) => panic!("expected search to succeed: {error:?}"),
        }
        .len(),
        1
    );
}

#[tokio::test]
async fn admins_act_as_owner_in_projects_they_did_not_join() {
    use process_flow_domain::membership::Role;
    let Team { services, project, owner, .. } = team().await;
    let admin = admin_actor();

    assert_eq!(
        match services.projects.get(&admin, &project).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .role,
        Role::Owner
    );
    assert_eq!(
        match services.projects.list(&admin, true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        1
    );
    let started = match services.workflows.start(&admin, &project, &standard_id(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    };
    seed_documents(&services, &started.workflow.id).await;
    let command = Command::CompleteTask { task_id: "goals".into() };
    match services.workflows.execute(&admin, &started.workflow.id, command, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    match services.memberships.put(&admin, &project, &owner.user_id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert_eq!(
        match services.memberships.members(&admin, &project).await {
            Ok(value) => value,
            Err(error) => panic!("expected members to succeed: {error:?}"),
        }
        .len(),
        3
    );

    let unowned = match services.projects.create_unowned("이전 워크플로", None).await {
        Ok(value) => value,
        Err(error) => panic!("expected create_unowned to succeed: {error:?}"),
    };
    assert_eq!(
        match services.projects.list(&admin, true).await {
            Ok(value) => value,
            Err(error) => panic!("expected list to succeed: {error:?}"),
        }
        .len(),
        2
    );
    assert!(is_hidden(&services.projects.get(&owner, &unowned.id).await));
    match services.memberships.put(&admin, &unowned.id, &owner.user_id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert_eq!(
        match services.projects.get(&owner, &unowned.id).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .role,
        Role::Owner
    );
}

async fn assigned_team() -> (Team, process_flow_domain::WorkflowId, process_flow_domain::user::Actor) {
    use process_flow_domain::assignment::{Assignments, StageAssignment};
    use process_flow_domain::membership::Role;
    let team = team().await;
    let admin = admin_actor();
    let other = match team.services.users.create(&admin, "other@example.com", "other", "password1").await {
        Ok(value) => value,
        Err(error) => panic!("expected create to succeed: {error:?}"),
    }
    .actor();
    match team.services.memberships.put(&team.owner, &team.project, &other.user_id, Role::Editor).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    let id = match team.services.workflows.start(&team.owner, &team.project, &standard_id(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    }
    .workflow
    .id;
    seed_documents(&team.services, &id).await;
    let planning = StageAssignment {
        accountable: Some(team.owner.user_id.clone()),
        responsible: [team.editor.user_id.clone()].into(),
        consulted: [team.viewer.user_id.clone()].into(),
        ..Default::default()
    };
    let proposed = Assignments { stages: [("planning".into(), planning)].into(), ..Default::default() };
    let saved = match team.services.assignments.replace(&team.owner, &id, proposed, Some(0)).await {
        Ok(value) => value,
        Err(error) => panic!("expected replace to succeed: {error:?}"),
    };
    assert_eq!(saved.version, 1);
    (team, id, other)
}

#[tokio::test]
async fn assigned_work_is_done_by_the_assigned_and_owners_override() {
    use process_flow_domain::assignment::Authority;
    let (team, id, other) = assigned_team().await;
    let Team { services, owner, editor, .. } = &team;
    let complete = |task: &str| Command::CompleteTask { task_id: task.into() };

    assert!(is_forbidden(&services.workflows.execute(&other, &id, complete("goals"), None).await));
    let note = Command::UpdateRecord {
        task_id: "goals".into(),
        link: None,
        note: Some("메모".into()),
        document: None,
        evidence: None,
    };
    assert!(is_forbidden(&services.workflows.execute(&other, &id, note.clone(), None).await));
    assert!(
        match services.store.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .is_empty()
    );

    let Command::UpdateRecord { task_id, link, note, .. } = note else { unreachable!() };
    let reviewed = match services.workflows.get(editor, &id).await {
        Ok(value) => value,
        Err(error) => panic!("expected get to succeed: {error:?}"),
    }
    .workflow
    .state
    .record(&task_id)
    .document;
    let note = Command::UpdateRecord { task_id, link, note, document: reviewed, evidence: None };
    match services.workflows.execute(editor, &id, note, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    match services.workflows.execute(editor, &id, complete("goals"), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    match services.workflows.execute(owner, &id, complete("user-research"), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    let authorities: Vec<_> = match services.store.events.lock() {
        Ok(value) => value,
        Err(error) => panic!("expected lock to succeed: {error:?}"),
    }
    .iter()
    .map(|e| e.authority)
    .collect();
    assert_eq!(authorities, vec![Authority::Assigned, Authority::Assigned, Authority::Override]);

    let rework = Command::RequestRework { task_id: "goals".into(), reason: "KPI 재정의".into() };
    assert!(is_forbidden(&services.workflows.execute(editor, &id, rework.clone(), None).await));
    match services.workflows.execute(owner, &id, rework, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    for task in &standard_spec().stages[0].tasks {
        match services.workflows.execute(editor, &id, Command::CompleteTask { task_id: task.clone() }, None).await {
            Ok(value) => value,
            Err(error) => panic!("expected execute to succeed: {error:?}"),
        };
    }
    let approve = Command::ApproveStage { stage_index: 0 };
    assert!(is_forbidden(&services.workflows.execute(editor, &id, approve.clone(), None).await));
    assert!(is_forbidden(&services.workflows.execute(&other, &id, approve.clone(), None).await));
    match services.workflows.execute(owner, &id, approve, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    assert_eq!(
        match match services.store.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .last()
        {
            Some(value) => value,
            None => panic!("expected last to be present"),
        }
        .authority,
        Authority::Assigned
    );

    let design = standard_spec().stages[1].tasks.clone();
    match services.workflows.execute(&other, &id, complete(design[0].as_str()), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    assert_eq!(
        match match services.store.events.lock() {
            Ok(value) => value,
            Err(error) => panic!("expected lock to succeed: {error:?}"),
        }
        .last()
        {
            Some(value) => value,
            None => panic!("expected last to be present"),
        }
        .authority,
        Authority::Open
    );
    let skipped = services.workflows.execute(&admin_actor(), &id, complete(design[2].as_str()), None).await;
    assert!(matches!(skipped, Err(ApplicationError::Rule(_))), "{skipped:?}");
}

#[tokio::test]
async fn assignments_are_edited_by_owners_and_validated() {
    use process_flow_domain::assignment::{Assignments, StageAssignment};
    let (team, id, other) = assigned_team().await;
    let Team { services, owner, editor, viewer, outsider, .. } = &team;
    let current = match services.assignments.get(viewer, &id).await {
        Ok(value) => value,
        Err(error) => panic!("expected get to succeed: {error:?}"),
    };
    assert_eq!(current.version, 1);
    assert_eq!(current.accountable_for(&"planning".into()), Some(&owner.user_id));
    assert!(is_hidden(&services.assignments.get(outsider, &id).await));

    for actor in [editor, viewer, &other] {
        assert!(is_forbidden(&services.assignments.replace(actor, &id, current.clone(), None).await));
    }
    assert!(is_hidden(&services.assignments.replace(outsider, &id, current.clone(), None).await));

    let with_task = |user: &process_flow_domain::UserId| Assignments {
        tasks: [("goals".into(), [user.clone()].into())].into(),
        ..current.clone()
    };
    let invalid = [
        with_task(&outsider.user_id),
        with_task(&viewer.user_id),
        Assignments { tasks: [("nope".into(), [editor.user_id.clone()].into())].into(), ..current.clone() },
        Assignments {
            stages: [(
                "nope".into(),
                StageAssignment { accountable: Some(owner.user_id.clone()), ..Default::default() },
            )]
            .into(),
            ..Default::default()
        },
    ];
    for proposed in invalid {
        let rejected = services.assignments.replace(owner, &id, proposed, None).await;
        assert!(matches!(rejected, Err(ApplicationError::Invalid(_))), "{rejected:?}");
    }

    let updated = match services.assignments.replace(owner, &id, with_task(&other.user_id), Some(1)).await {
        Ok(value) => value,
        Err(error) => panic!("expected replace to succeed: {error:?}"),
    };
    assert_eq!(updated.version, 2);
    let complete = || Command::CompleteTask { task_id: "goals".into() };
    assert!(is_forbidden(&services.workflows.execute(editor, &id, complete(), None).await));
    match services.workflows.execute(&other, &id, complete(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };

    let same = match services.assignments.replace(owner, &id, updated.clone(), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected replace to succeed: {error:?}"),
    };
    assert_eq!(same.version, 2);
    let stale = services.assignments.replace(owner, &id, Assignments::default(), Some(1)).await;
    assert!(matches!(stale, Err(ApplicationError::VersionConflict { expected: 1 })), "{stale:?}");
    let changes = match services.store.assignment_changes.lock() {
        Ok(value) => value,
        Err(error) => panic!("expected lock to succeed: {error:?}"),
    }
    .clone();
    assert_eq!(changes, vec![(id.clone(), 1, owner.user_id.clone()), (id.clone(), 2, owner.user_id.clone())]);

    match services.users.deactivate(&admin_actor(), &other.user_id).await {
        Ok(value) => value,
        Err(error) => panic!("expected deactivate to succeed: {error:?}"),
    };
    let inactive = services.assignments.replace(owner, &id, Assignments { version: 0, ..updated }, None).await;
    assert_eq!(
        match inactive {
            Ok(value) => value,
            Err(error) => panic!("expected inactive assignments to succeed: {error:?}"),
        }
        .version,
        2
    );
    let reassigned = Assignments {
        stages: [("design".into(), StageAssignment { accountable: Some(other.user_id.clone()), ..Default::default() })]
            .into(),
        ..Default::default()
    };
    let rejected = services.assignments.replace(owner, &id, reassigned, None).await;
    assert!(matches!(rejected, Err(ApplicationError::Invalid(_))), "{rejected:?}");
}

#[tokio::test]
async fn leaving_or_becoming_a_viewer_releases_assignments() {
    use process_flow_domain::membership::Role;
    let (team, id, other) = assigned_team().await;
    let Team { services, project, owner, editor, viewer, .. } = &team;
    let complete = |task: &str| Command::CompleteTask { task_id: task.into() };
    assert!(is_forbidden(&services.workflows.execute(&other, &id, complete("goals"), None).await));

    match services.memberships.put(owner, project, &editor.user_id, Role::Viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    let after = match services.assignments.get(owner, &id).await {
        Ok(value) => value,
        Err(error) => panic!("expected get to succeed: {error:?}"),
    };
    assert!(after.responsible_for(&standard_process(), &"goals".into()).is_empty());
    assert_eq!(after.version, 2);
    match services.workflows.execute(&other, &id, complete("goals"), None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };

    assert!(after.stages[&"planning".into()].consulted.contains(&viewer.user_id));
    match services.memberships.remove(owner, project, &viewer.user_id).await {
        Ok(value) => value,
        Err(error) => panic!("expected remove to succeed: {error:?}"),
    };
    let after = match services.assignments.get(owner, &id).await {
        Ok(value) => value,
        Err(error) => panic!("expected get to succeed: {error:?}"),
    };
    assert!(after.stages[&"planning".into()].consulted.is_empty());
    assert_eq!(after.accountable_for(&"planning".into()), Some(&owner.user_id));

    let version = after.version;
    match services.memberships.put(owner, project, &other.user_id, Role::Owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert_eq!(
        match services.assignments.get(owner, &id).await {
            Ok(value) => value,
            Err(error) => panic!("expected get to succeed: {error:?}"),
        }
        .version,
        version
    );
}

#[tokio::test]
async fn my_work_gathers_assigned_and_open_items_across_my_projects() {
    use process_flow_domain::membership::Role;
    use process_flow_domain::work::{Readiness, WorkTarget};
    let (team, id, other) = assigned_team().await;
    let Team { services, project, owner, editor, viewer, outsider } = &team;
    let tasks = |work: &[process_flow_runtime::WorkflowWork]| {
        work.iter()
            .flat_map(|found| found.work.assigned.iter())
            .filter(|item| item.readiness == Readiness::Ready)
            .map(|item| match &item.target {
                WorkTarget::Task { task_id, .. } => task_id.to_string(),
                WorkTarget::Approval => "(approve)".to_owned(),
            })
            .collect::<Vec<_>>()
    };

    let mine = match services.work.mine(editor).await {
        Ok(value) => value,
        Err(error) => panic!("expected mine to succeed: {error:?}"),
    };
    assert_eq!(mine.len(), 1);
    assert_eq!((mine[0].project.id.clone(), mine[0].workflow.id.clone()), (project.clone(), id.clone()));
    assert_eq!(tasks(&mine), vec!["goals"]);
    assert_eq!(mine[0].work.assigned.len(), 7);
    let approvals = match services.work.mine(owner).await {
        Ok(value) => value,
        Err(error) => panic!("expected mine to succeed: {error:?}"),
    };
    assert_eq!(approvals[0].work.assigned.len(), 1);
    assert_eq!(approvals[0].work.assigned[0].readiness, Readiness::AfterTasks { remaining: 7 });
    assert!(
        match services.work.mine(&other).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }
        .is_empty()
    );
    assert!(
        match services.work.mine(outsider).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }
        .is_empty()
    );
    let watching = match services.work.mine(viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected mine to succeed: {error:?}"),
    };
    assert!(watching[0].work.assigned.is_empty() && watching[0].work.open.is_empty());
    assert_eq!(watching[0].work.watching.len(), 1);

    let second = match services.workflows.start(owner, project, &standard_id(), Some("둘째".into())).await {
        Ok(value) => value,
        Err(error) => panic!("expected start to succeed: {error:?}"),
    }
    .workflow;
    let open = match services.work.mine(&other).await {
        Ok(value) => value,
        Err(error) => panic!("expected mine to succeed: {error:?}"),
    };
    assert_eq!(open.iter().map(|found| found.workflow.id.clone()).collect::<Vec<_>>(), vec![second.id.clone()]);
    assert_eq!(open[0].work.open.len(), 1);
    let both = match services.work.mine(editor).await {
        Ok(value) => value,
        Err(error) => panic!("expected mine to succeed: {error:?}"),
    };
    assert_eq!(both.iter().map(|found| found.workflow.id.clone()).collect::<Vec<_>>(), vec![id.clone(), second.id]);

    assert!(
        match services.work.mine(&admin_actor()).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }
        .is_empty()
    );

    let command = Command::CompleteTask { task_id: "goals".into() };
    match services.workflows.execute(editor, &id, command, None).await {
        Ok(value) => value,
        Err(error) => panic!("expected execute to succeed: {error:?}"),
    };
    assert_eq!(
        tasks(&match services.work.mine(editor).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }),
        vec!["user-research"]
    );
    match services.memberships.put(owner, project, &other.user_id, Role::Viewer).await {
        Ok(value) => value,
        Err(error) => panic!("expected put to succeed: {error:?}"),
    };
    assert!(
        match services.work.mine(&other).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }
        .is_empty()
    );
    match services.projects.archive(owner, project).await {
        Ok(value) => value,
        Err(error) => panic!("expected archive to succeed: {error:?}"),
    };
    assert!(
        match services.work.mine(editor).await {
            Ok(value) => value,
            Err(error) => panic!("expected mine to succeed: {error:?}"),
        }
        .is_empty()
    );
}
