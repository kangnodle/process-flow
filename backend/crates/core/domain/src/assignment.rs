use std::collections::{BTreeMap, BTreeSet};

use crate::error::DomainError;
use crate::ids::{StageId, TaskId, UserId};
use crate::membership::{Permission, Role};
use crate::process::Process;
use crate::workflow::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkflowRole<'a> {
    TaskExecutor(&'a TaskId),
    StageApprover(usize),
    RecordAuthor(&'a TaskId),
    ReworkRequester(&'a TaskId),
}

impl<'a> WorkflowRole<'a> {
    pub fn for_command(command: &'a Command) -> Self {
        match command {
            Command::CompleteTask { task_id } | Command::ReopenTask { task_id } => Self::TaskExecutor(task_id),
            Command::ApproveStage { stage_index } => Self::StageApprover(*stage_index),
            Command::UpdateRecord { task_id, .. } => Self::RecordAuthor(task_id),
            Command::RequestRework { task_id, .. } => Self::ReworkRequester(task_id),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StageAssignment {
    pub accountable: Option<UserId>,
    pub responsible: BTreeSet<UserId>,
    pub consulted: BTreeSet<UserId>,
    pub informed: BTreeSet<UserId>,
}

impl StageAssignment {
    fn is_empty(&self) -> bool {
        self.accountable.is_none()
            && self.responsible.is_empty()
            && self.consulted.is_empty()
            && self.informed.is_empty()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Assignments {
    pub stages: BTreeMap<StageId, StageAssignment>,
    pub tasks: BTreeMap<TaskId, BTreeSet<UserId>>,
    pub version: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Authority {
    Assigned,
    Open,
    Override,
}

impl Authority {
    pub const ALL: &'static [Self] = &[Self::Assigned, Self::Open, Self::Override];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Assigned => "assigned",
            Self::Open => "open",
            Self::Override => "override",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|authority| authority.as_str() == value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotAssigned {
    NotResponsible { task_id: TaskId },
    NotAccountable { stage_id: StageId },
}

impl std::fmt::Display for NotAssigned {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotResponsible { task_id } => write!(f, "작업 {task_id}의 담당자만 할 수 있습니다"),
            Self::NotAccountable { stage_id } => write!(f, "단계 {stage_id}의 승인자만 할 수 있습니다"),
        }
    }
}

fn invalid(reason: String) -> DomainError {
    DomainError::InvalidAssignment(reason)
}

impl Assignments {
    pub fn validated(mut self, process: &Process) -> Result<Self, DomainError> {
        for stage_id in self.stages.keys() {
            if !process.stages().iter().any(|stage| &stage.id == stage_id) {
                return Err(invalid(format!("공정에 없는 단계입니다: {stage_id}")));
            }
        }
        for task_id in self.tasks.keys() {
            process.task(task_id).map_err(|_| invalid(format!("공정에 없는 작업입니다: {task_id}")))?;
        }
        self.stages.retain(|_, stage| !stage.is_empty());
        self.tasks.retain(|_, responsible| !responsible.is_empty());
        Ok(self)
    }

    pub fn responsible_for(&self, process: &Process, task_id: &TaskId) -> BTreeSet<UserId> {
        if let Some(own) = self.tasks.get(task_id).filter(|own| !own.is_empty()) {
            return own.clone();
        }
        process
            .task(task_id)
            .ok()
            .and_then(|task| self.stages.get(&task.stage_id))
            .map(|stage| stage.responsible.clone())
            .unwrap_or_default()
    }

    pub fn accountable_for(&self, stage_id: &StageId) -> Option<&UserId> {
        self.stages.get(stage_id).and_then(|stage| stage.accountable.as_ref())
    }

    pub fn executors(&self) -> BTreeSet<UserId> {
        let stages = self.stages.values().flat_map(|stage| stage.accountable.iter().chain(&stage.responsible));
        stages.chain(self.tasks.values().flatten()).cloned().collect()
    }

    pub fn everyone(&self) -> BTreeSet<UserId> {
        let watchers = self.stages.values().flat_map(|stage| stage.consulted.iter().chain(&stage.informed));
        watchers.cloned().chain(self.executors()).collect()
    }

    pub fn without(&self, user_id: &UserId, keep_watching: bool) -> Option<Self> {
        let mut next = self.clone();
        for stage in next.stages.values_mut() {
            if stage.accountable.as_ref() == Some(user_id) {
                stage.accountable = None;
            }
            stage.responsible.remove(user_id);
            if !keep_watching {
                stage.consulted.remove(user_id);
                stage.informed.remove(user_id);
            }
        }
        for responsible in next.tasks.values_mut() {
            responsible.remove(user_id);
        }
        next.stages.retain(|_, stage| !stage.is_empty());
        next.tasks.retain(|_, responsible| !responsible.is_empty());
        if next == *self {
            return None;
        }
        next.version = self.version + 1;
        Some(next)
    }

    pub fn task_authority(
        &self,
        process: &Process,
        user_id: &UserId,
        role: Role,
        task_id: &TaskId,
    ) -> Option<Authority> {
        authority(role, user_id, &self.responsible_for(process, task_id))
    }

    pub fn stage_authority(&self, user_id: &UserId, role: Role, stage_id: &StageId) -> Option<Authority> {
        authority(role, user_id, &self.accountable_for(stage_id).cloned().into_iter().collect())
    }

    pub fn authorize(
        &self,
        process: &Process,
        user_id: &UserId,
        role: Role,
        command: &Command,
    ) -> Result<Authority, NotAssigned> {
        self.authorize_role(process, user_id, role, WorkflowRole::for_command(command))
    }

    pub fn authorize_role(
        &self,
        process: &Process,
        user_id: &UserId,
        role: Role,
        interaction_role: WorkflowRole<'_>,
    ) -> Result<Authority, NotAssigned> {
        match interaction_role {
            WorkflowRole::TaskExecutor(task_id) | WorkflowRole::RecordAuthor(task_id) => self
                .task_authority(process, user_id, role, task_id)
                .ok_or_else(|| NotAssigned::NotResponsible { task_id: task_id.clone() }),
            WorkflowRole::StageApprover(stage_index) => {
                let Ok(stage) = process.stage(stage_index) else { return Ok(Authority::Open) };
                self.stage_authority(user_id, role, &stage.id)
                    .ok_or_else(|| NotAssigned::NotAccountable { stage_id: stage.id.clone() })
            }
            WorkflowRole::ReworkRequester(task_id) => {
                let Ok(task) = process.task(task_id) else { return Ok(Authority::Open) };
                self.stage_authority(user_id, role, &task.stage_id)
                    .ok_or_else(|| NotAssigned::NotAccountable { stage_id: task.stage_id.clone() })
            }
        }
    }
}

fn authority(role: Role, user_id: &UserId, assigned: &BTreeSet<UserId>) -> Option<Authority> {
    if !role.allows(Permission::ExecuteCommand) {
        None
    } else if assigned.is_empty() {
        Some(Authority::Open)
    } else if assigned.contains(user_id) {
        Some(Authority::Assigned)
    } else if role == Role::Owner {
        Some(Authority::Override)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::standard::standard_process;

    fn users(ids: &[&str]) -> BTreeSet<UserId> {
        ids.iter().map(|id| UserId::from(*id)).collect()
    }

    fn sample() -> Assignments {
        let planning = StageAssignment {
            accountable: Some("ann".into()),
            responsible: users(&["bob"]),
            consulted: users(&["dan"]),
            informed: users(&["eve"]),
        };
        Assignments {
            stages: BTreeMap::from([("planning".into(), planning)]),
            tasks: BTreeMap::from([("goals".into(), users(&["cho"]))]),
            version: 3,
        }
    }

    fn complete(task: &str) -> Command {
        Command::CompleteTask { task_id: task.into() }
    }

    #[test]
    fn task_responsible_falls_back_to_stage_default() {
        let process = standard_process();
        let assignments = sample();
        assert_eq!(assignments.responsible_for(&process, &"goals".into()), users(&["cho"]));
        assert_eq!(assignments.responsible_for(&process, &"user-research".into()), users(&["bob"]));
        assert!(assignments.responsible_for(&process, &"wireframes".into()).is_empty());
        assert_eq!(assignments.accountable_for(&"planning".into()), Some(&"ann".into()));
        assert_eq!(assignments.accountable_for(&"design".into()), None);
        assert_eq!(assignments.executors(), users(&["ann", "bob", "cho"]));
        assert_eq!(assignments.everyone(), users(&["ann", "bob", "cho", "dan", "eve"]));
    }

    #[test]
    fn only_the_assigned_run_assigned_work_and_owners_override() {
        let process = standard_process();
        let assignments = sample();
        let run =
            |user: &str, role: Role, command: &Command| assignments.authorize(&process, &user.into(), role, command);
        let not_responsible = |task: &str| Err(NotAssigned::NotResponsible { task_id: task.into() });
        let not_accountable = || Err(NotAssigned::NotAccountable { stage_id: "planning".into() });

        assert_eq!(run("cho", Role::Editor, &complete("goals")), Ok(Authority::Assigned));
        assert_eq!(run("bob", Role::Editor, &complete("goals")), not_responsible("goals"));
        assert_eq!(run("bob", Role::Editor, &complete("user-research")), Ok(Authority::Assigned));
        let reopen = Command::ReopenTask { task_id: "goals".into() };
        let record = Command::UpdateRecord {
            task_id: "goals".into(),
            link: None,
            note: Some("메모".into()),
            document: None,
            evidence: None,
        };
        for command in [&reopen, &record] {
            assert_eq!(run("cho", Role::Editor, command), Ok(Authority::Assigned));
            assert_eq!(run("ann", Role::Editor, command), not_responsible("goals"));
        }

        let approve = Command::ApproveStage { stage_index: 0 };
        let rework = Command::RequestRework { task_id: "goals".into(), reason: "다시".into() };
        for command in [&approve, &rework] {
            assert_eq!(run("ann", Role::Editor, command), Ok(Authority::Assigned));
            assert_eq!(run("cho", Role::Editor, command), not_accountable());
        }

        assert_eq!(run("zed", Role::Owner, &complete("goals")), Ok(Authority::Override));
        assert_eq!(run("zed", Role::Owner, &approve), Ok(Authority::Override));
        assert_eq!(run("ann", Role::Owner, &approve), Ok(Authority::Assigned));

        assert_eq!(run("zed", Role::Editor, &complete("wireframes")), Ok(Authority::Open));
        assert_eq!(run("zed", Role::Editor, &Command::ApproveStage { stage_index: 1 }), Ok(Authority::Open));
        assert_eq!(run("zed", Role::Editor, &Command::ApproveStage { stage_index: 99 }), Ok(Authority::Open));
    }

    #[test]
    fn viewers_have_no_authority_even_when_assigned() {
        let process = standard_process();
        let assignments = sample();
        assert_eq!(assignments.task_authority(&process, &"cho".into(), Role::Viewer, &"goals".into()), None);
        assert_eq!(assignments.task_authority(&process, &"zed".into(), Role::Viewer, &"wireframes".into()), None);
        assert_eq!(assignments.stage_authority(&"ann".into(), Role::Viewer, &"planning".into()), None);
        assert_eq!(
            assignments.stage_authority(&"ann".into(), Role::Editor, &"planning".into()),
            Some(Authority::Assigned)
        );
    }

    #[test]
    fn validation_rejects_unknown_targets_and_drops_empty_entries() {
        let process = standard_process();
        let mut assignments = sample();
        assignments.stages.insert("design".into(), StageAssignment::default());
        assignments.tasks.insert("wireframes".into(), BTreeSet::new());
        let cleaned = match assignments.validated(&process) {
            Ok(value) => value,
            Err(error) => panic!("expected validated to succeed: {error:?}"),
        };
        assert_eq!(cleaned, sample());

        let mut unknown_stage = sample();
        unknown_stage
            .stages
            .insert("nope".into(), StageAssignment { accountable: Some("ann".into()), ..Default::default() });
        assert!(matches!(unknown_stage.validated(&process), Err(DomainError::InvalidAssignment(_))));
        let mut unknown_task = sample();
        unknown_task.tasks.insert("nope".into(), users(&["ann"]));
        assert!(matches!(unknown_task.validated(&process), Err(DomainError::InvalidAssignment(_))));
    }

    #[test]
    fn removing_a_user_clears_their_assignments() {
        let assignments = sample();
        assert_eq!(assignments.without(&"zed".into(), false), None);

        let no_cho = match assignments.without(&"cho".into(), false) {
            Some(value) => value,
            None => panic!("expected assignment removal to change assignments"),
        };
        assert!(no_cho.tasks.is_empty());
        assert_eq!(no_cho.version, 4);
        let no_dan = match assignments.without(&"dan".into(), false) {
            Some(value) => value,
            None => panic!("expected assignment removal to change assignments"),
        };
        assert!(no_dan.stages[&StageId::from("planning")].consulted.is_empty());

        assert_eq!(assignments.without(&"dan".into(), true), None);
        let no_ann = match assignments.without(&"ann".into(), true) {
            Some(value) => value,
            None => panic!("expected assignment removal to change assignments"),
        };
        assert_eq!(no_ann.accountable_for(&"planning".into()), None);
        assert_eq!(no_ann.stages[&StageId::from("planning")].responsible, users(&["bob"]));
    }

    #[test]
    fn authority_names_round_trip() {
        for authority in Authority::ALL {
            assert_eq!(Authority::parse(authority.as_str()), Some(*authority));
        }
        assert_eq!(Authority::parse("admin"), None);
    }
}
