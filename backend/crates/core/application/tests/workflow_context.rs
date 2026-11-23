use process_flow_application::ApplicationError;
use process_flow_application::contexts::workflow::{CommandValidation, ValidatedCommand, WorkflowCommandContext};
use process_flow_domain::RuleViolation;
use process_flow_domain::assignment::Assignments;
use process_flow_domain::membership::Role;
use process_flow_domain::process::standard::standard_process;
use process_flow_domain::workflow::{Command, Workflow};

#[test]
fn malformed_record_errors_follow_version_authority_and_task_rules_even_for_unchanged_commands() {
    let process = standard_process();
    let workflow = Workflow::start("workflow".into(), "project".into(), process.id().clone(), "Test".into());
    let assignments = Assignments::default();
    let actor = "user".into();
    let mut context = WorkflowCommandContext {
        workflow: &workflow,
        process: &process,
        assignments: &assignments,
        actor: &actor,
        access_role: Role::Editor,
    };
    let invalid = |task: &str| ValidatedCommand {
        command: Command::UpdateRecord { task_id: task.into(), link: None, note: None, document: None, evidence: None },
        validation: CommandValidation::InvalidRecord(RuleViolation::InvalidRecord("bad status".into())),
    };
    assert!(matches!(context.plan(&invalid("goals"), Some(1)), Err(ApplicationError::VersionConflict { expected: 1 })));
    context.access_role = Role::Viewer;
    assert!(matches!(context.plan(&invalid("goals"), Some(0)), Err(ApplicationError::Forbidden(_))));
    context.access_role = Role::Editor;
    assert!(matches!(
        context.plan(&invalid("wireframes"), Some(0)),
        Err(ApplicationError::Rule(RuleViolation::StageLocked { .. }))
    ));
    assert!(matches!(context.plan(&invalid("missing"), Some(0)), Err(ApplicationError::NotFound { .. })));
    assert!(matches!(
        context.plan(&invalid("goals"), Some(0)),
        Err(ApplicationError::Rule(RuleViolation::InvalidRecord(_)))
    ));
    let mut assigned = Assignments::default();
    assigned.tasks.insert("goals".into(), ["someone-else".into()].into());
    let assigned_context = WorkflowCommandContext { assignments: &assigned, ..context };
    assert!(matches!(assigned_context.plan(&invalid("goals"), Some(0)), Err(ApplicationError::Forbidden(_))));
    let mut completed = workflow.clone();
    completed.state.phase = process_flow_domain::workflow::Phase::Working { stage_index: 0, completed: 1 };
    let completed_context = WorkflowCommandContext { workflow: &completed, ..context };
    assert!(matches!(
        completed_context.plan(&invalid("goals"), Some(0)),
        Err(ApplicationError::Rule(RuleViolation::RecordReadOnly { .. }))
    ));
    assert_eq!(workflow.version, 0);
    assert!(workflow.state.records.is_empty());
}

#[test]
fn bound_workflow_roles_share_command_authorization() {
    let process = standard_process();
    let workflow = Workflow::start("workflow".into(), "project".into(), process.id().clone(), "Test".into());
    let mut assignments = Assignments::default();
    assignments.tasks.insert("goals".into(), ["assigned".into()].into());
    assignments.stages.insert(
        "planning".into(),
        process_flow_domain::assignment::StageAssignment { accountable: Some("assigned".into()), ..Default::default() },
    );
    let commands = [
        Command::CompleteTask { task_id: "goals".into() },
        Command::ReopenTask { task_id: "goals".into() },
        Command::UpdateRecord { task_id: "goals".into(), link: None, note: None, document: None, evidence: None },
        Command::ApproveStage { stage_index: 0 },
        Command::RequestRework { task_id: "goals".into(), reason: "Revise".into() },
        Command::CompleteTask { task_id: "wireframes".into() },
        Command::ApproveStage { stage_index: 99 },
        Command::RequestRework { task_id: "missing".into(), reason: "Revise".into() },
    ];
    for actor in ["assigned".into(), "other".into()] {
        for access_role in [Role::Owner, Role::Editor, Role::Viewer] {
            let context = WorkflowCommandContext {
                workflow: &workflow,
                process: &process,
                assignments: &assignments,
                actor: &actor,
                access_role,
            };
            for command in &commands {
                assert_eq!(
                    assignments.authorize(&process, &actor, access_role, command),
                    assignments.authorize_role(&process, &actor, access_role, context.interaction_role(command))
                );
            }
        }
    }
}
