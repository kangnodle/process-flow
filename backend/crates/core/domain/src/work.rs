use crate::assignment::Assignments;
use crate::ids::{StageId, TaskId, UserId};
use crate::membership::{Permission, Role};
use crate::process::Process;
use crate::workflow::{Phase, WorkflowState};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Readiness {
    Ready,
    AfterTasks { remaining: usize },
    StageLocked,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkTarget {
    Task { task_id: TaskId, number: usize },
    Approval,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkItem {
    pub stage_id: StageId,
    pub stage_index: usize,
    pub target: WorkTarget,
    pub readiness: Readiness,
    pub rework: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Watch {
    Consulted,
    Informed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Watching {
    pub stage_id: StageId,
    pub stage_index: usize,
    pub watch: Watch,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MyWork {
    pub assigned: Vec<WorkItem>,
    pub open: Vec<WorkItem>,
    pub watching: Vec<Watching>,
}

impl MyWork {
    pub fn is_empty(&self) -> bool {
        self.assigned.is_empty() && self.open.is_empty() && self.watching.is_empty()
    }
}

pub fn my_work(
    process: &Process,
    state: &WorkflowState,
    assignments: &Assignments,
    user_id: &UserId,
    role: Role,
) -> MyWork {
    let phase = state.phase;
    if phase == Phase::Finished {
        return MyWork::default();
    }
    let can_execute = role.allows(Permission::ExecuteCommand);
    let front = phase.front_stage(process);
    let current = phase.current_task(process);
    let mut work = MyWork::default();

    for stage in process.stages().iter().filter(|stage| stage.index >= front) {
        let remaining_in_stage = stage.tasks.iter().filter(|task| !phase.is_done(process, task)).count();

        if can_execute {
            for task in stage.tasks.iter().filter(|task| !phase.is_done(process, task)) {
                let is_current = current.is_some_and(|current| current.id == task.id);
                let readiness = match current {
                    _ if stage.index > front => Readiness::StageLocked,
                    Some(_) if is_current => Readiness::Ready,
                    Some(current) => Readiness::AfterTasks { remaining: task.number - current.number },
                    None => Readiness::Ready,
                };
                let item = WorkItem {
                    stage_id: stage.id.clone(),
                    stage_index: stage.index,
                    target: WorkTarget::Task { task_id: task.id.clone(), number: task.number },
                    readiness,
                    rework: state.is_rework(process, task),
                };
                let responsible = assignments.responsible_for(process, &task.id);
                if responsible.contains(user_id) {
                    work.assigned.push(item);
                } else if responsible.is_empty() && readiness == Readiness::Ready {
                    work.open.push(item);
                }
            }

            if stage.index < process.last_stage_index() {
                let readiness = if stage.index > front {
                    Readiness::StageLocked
                } else if phase == (Phase::AwaitingApproval { stage_index: stage.index }) {
                    Readiness::Ready
                } else {
                    Readiness::AfterTasks { remaining: remaining_in_stage }
                };
                let item = WorkItem {
                    stage_id: stage.id.clone(),
                    stage_index: stage.index,
                    target: WorkTarget::Approval,
                    readiness,
                    rework: false,
                };
                match assignments.accountable_for(&stage.id) {
                    Some(accountable) if accountable == user_id => work.assigned.push(item),
                    None if readiness == Readiness::Ready => work.open.push(item),
                    _ => {}
                }
            }
        }

        if stage.index == front
            && let Some(assigned) = assignments.stages.get(&stage.id)
        {
            for (members, watch) in [(&assigned.consulted, Watch::Consulted), (&assigned.informed, Watch::Informed)] {
                if members.contains(user_id) {
                    work.watching.push(Watching { stage_id: stage.id.clone(), stage_index: stage.index, watch });
                }
            }
        }
    }
    work
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::assignment::StageAssignment;
    use crate::process::standard::standard_process;
    use crate::workflow::{Command, Decision, decide};

    fn users(ids: &[&str]) -> std::collections::BTreeSet<UserId> {
        ids.iter().map(|id| UserId::from(*id)).collect()
    }

    fn assignments() -> Assignments {
        let planning = StageAssignment {
            accountable: Some("ann".into()),
            responsible: users(&["bob"]),
            consulted: users(&["dan"]),
            informed: users(&["eve"]),
        };
        let design =
            StageAssignment { accountable: Some("ann".into()), responsible: users(&["bob"]), ..Default::default() };
        Assignments {
            stages: BTreeMap::from([("planning".into(), planning), ("design".into(), design)]),
            tasks: BTreeMap::from([("goals".into(), users(&["cho"]))]),
            version: 1,
        }
    }

    fn run(process: &Process, state: &WorkflowState, command: Command) -> WorkflowState {
        let mut state = state.clone();
        if let Command::CompleteTask { task_id } = &command {
            use crate::workflow::{TaskDocument, task_form};
            state.records.entry(task_id.clone()).or_default().document = Some(TaskDocument {
                version: 1,
                review_status: crate::workflow::ReviewStatus::Passed,
                answers: task_form(task_id.as_str())
                    .iter()
                    .map(|field| (field.id.into(), "Verified outcome".into()))
                    .collect(),
            });
        }
        match match decide(process, &state, &command) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        } {
            Decision::Changed { state, .. } => state,
            Decision::Unchanged => state.clone(),
        }
    }

    fn complete_stage(process: &Process, mut state: WorkflowState, stage_index: usize) -> WorkflowState {
        for task in &match process.stage(stage_index) {
            Ok(value) => value,
            Err(error) => panic!("expected stage to succeed: {error:?}"),
        }
        .tasks
        {
            state = run(process, &state, Command::CompleteTask { task_id: task.id.clone() });
        }
        state
    }

    fn of(process: &Process, state: &WorkflowState, user: &str, role: Role) -> MyWork {
        my_work(process, state, &assignments(), &user.into(), role)
    }

    fn task_ids(items: &[WorkItem]) -> Vec<(&str, Readiness)> {
        items
            .iter()
            .map(|item| match &item.target {
                WorkTarget::Task { task_id, .. } => (task_id.as_str(), item.readiness),
                WorkTarget::Approval => ("(approve)", item.readiness),
            })
            .collect()
    }

    #[test]
    fn assigned_tasks_show_whether_it_is_my_turn() {
        let process = standard_process();
        let state = WorkflowState::default();

        let cho = of(&process, &state, "cho", Role::Editor);
        assert_eq!(task_ids(&cho.assigned), vec![("goals", Readiness::Ready)]);
        assert!(cho.open.is_empty() && cho.watching.is_empty());

        let bob = of(&process, &state, "bob", Role::Editor);
        let planning: Vec<_> = bob.assigned.iter().filter(|item| item.stage_index == 0).collect();
        assert_eq!(planning.len(), 6);
        assert_eq!(planning[0].readiness, Readiness::AfterTasks { remaining: 1 });
        assert_eq!(planning[5].readiness, Readiness::AfterTasks { remaining: 6 });
        let design: Vec<_> = bob.assigned.iter().filter(|item| item.stage_index == 1).collect();
        assert_eq!(
            design.len(),
            match process.stage(1) {
                Ok(value) => value,
                Err(error) => panic!("expected stage to succeed: {error:?}"),
            }
            .tasks
            .len()
        );
        assert!(design.iter().all(|item| item.readiness == Readiness::StageLocked));

        let state = run(&process, &state, Command::CompleteTask { task_id: "goals".into() });
        assert!(of(&process, &state, "cho", Role::Editor).assigned.is_empty());
        let bob = of(&process, &state, "bob", Role::Editor);
        assert_eq!(task_ids(&bob.assigned)[0], ("user-research", Readiness::Ready));
        assert_eq!(task_ids(&bob.assigned)[1].1, Readiness::AfterTasks { remaining: 1 });
    }

    #[test]
    fn approvals_wait_for_the_stage_then_become_ready() {
        let process = standard_process();
        let state = WorkflowState::default();
        let approvals = |state: &WorkflowState| {
            of(&process, state, "ann", Role::Editor)
                .assigned
                .into_iter()
                .filter(|item| item.target == WorkTarget::Approval)
                .map(|item| (item.stage_index, item.readiness))
                .collect::<Vec<_>>()
        };
        assert_eq!(approvals(&state), vec![(0, Readiness::AfterTasks { remaining: 7 }), (1, Readiness::StageLocked)]);

        let awaiting = complete_stage(&process, state, 0);
        assert_eq!(approvals(&awaiting)[0], (0, Readiness::Ready));
        assert!(of(&process, &awaiting, "bob", Role::Editor).assigned.iter().all(|item| item.stage_index == 1));

        let approved = run(&process, &awaiting, Command::ApproveStage { stage_index: 0 });
        let design_tasks = match process.stage(1) {
            Ok(value) => value,
            Err(error) => panic!("expected stage to succeed: {error:?}"),
        }
        .tasks
        .len();
        assert_eq!(approvals(&approved), vec![(1, Readiness::AfterTasks { remaining: design_tasks })]);
        assert_eq!(of(&process, &approved, "bob", Role::Editor).assigned[0].readiness, Readiness::Ready);
    }

    #[test]
    fn unassigned_work_is_open_only_when_it_can_be_done_now() {
        let process = standard_process();
        let none = Assignments::default();
        let state = WorkflowState::default();
        let open = |state: &WorkflowState, role: Role| my_work(&process, state, &none, &"zed".into(), role);

        let work = open(&state, Role::Editor);
        assert_eq!(task_ids(&work.open), vec![("goals", Readiness::Ready)]);
        assert!(work.assigned.is_empty());
        assert!(open(&state, Role::Viewer).is_empty());

        let awaiting = complete_stage(&process, state, 0);
        assert_eq!(task_ids(&open(&awaiting, Role::Owner).open), vec![("(approve)", Readiness::Ready)]);

        let state = WorkflowState::default();
        assert!(my_work(&process, &state, &assignments(), &"zed".into(), Role::Owner).is_empty());
    }

    #[test]
    fn consulted_and_informed_watch_the_current_stage() {
        let process = standard_process();
        let state = WorkflowState::default();
        let dan = of(&process, &state, "dan", Role::Viewer);
        assert_eq!(
            dan.watching,
            vec![Watching { stage_id: "planning".into(), stage_index: 0, watch: Watch::Consulted }]
        );
        assert!(dan.assigned.is_empty() && dan.open.is_empty());
        assert_eq!(of(&process, &state, "eve", Role::Editor).watching[0].watch, Watch::Informed);

        let next = run(&process, &complete_stage(&process, state, 0), Command::ApproveStage { stage_index: 0 });
        assert!(of(&process, &next, "dan", Role::Viewer).watching.is_empty());
    }

    #[test]
    fn rework_is_marked_and_finished_workflows_have_no_work() {
        let process = standard_process();
        let mut state = WorkflowState::default();
        for task in ["goals", "user-research"] {
            state = run(&process, &state, Command::CompleteTask { task_id: task.into() });
        }
        let state = run(&process, &state, Command::RequestRework { task_id: "goals".into(), reason: "다시".into() });
        let cho = of(&process, &state, "cho", Role::Editor);
        assert_eq!(task_ids(&cho.assigned), vec![("goals", Readiness::Ready)]);
        assert!(cho.assigned[0].rework);

        let finished = WorkflowState { phase: Phase::Finished, ..WorkflowState::default() };
        for user in ["ann", "bob", "cho", "dan"] {
            assert!(of(&process, &finished, user, Role::Owner).is_empty());
        }
        let last = process.last_stage_index();
        let all_mine = Assignments {
            stages: process
                .stages()
                .iter()
                .map(|stage| {
                    (stage.id.clone(), StageAssignment { accountable: Some("ann".into()), ..Default::default() })
                })
                .collect(),
            ..Default::default()
        };
        let work = my_work(&process, &WorkflowState::default(), &all_mine, &"ann".into(), Role::Editor);
        assert_eq!(work.assigned.len(), last);
        assert!(work.assigned.iter().all(|item| item.stage_index < last));
    }
}
