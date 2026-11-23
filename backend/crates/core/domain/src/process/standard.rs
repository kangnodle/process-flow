use super::model::{Process, ProcessSpec, StageSpec, define_process};

pub const STANDARD_PROCESS_ID: &str = "standard";

const STAGES: &[(&str, &[&str])] = &[
    (
        "planning",
        &[
            "goals",
            "user-research",
            "user-modeling",
            "requirements",
            "information-architecture",
            "user-flows",
            "constraints",
        ],
    ),
    ("design", &["wireframes", "prototyping", "visual-design", "design-system", "technical-design", "design-handoff"]),
    ("development", &["dev-environment", "implementation", "unit-testing"]),
    ("testing", &["integration-testing", "non-functional-testing", "acceptance-testing"]),
    ("release", &["release-prep", "deployment"]),
    ("operations", &["monitoring", "feedback-analysis", "maintenance", "iteration"]),
];

pub fn standard_spec() -> ProcessSpec {
    ProcessSpec {
        id: STANDARD_PROCESS_ID.into(),
        stages: STAGES
            .iter()
            .map(|(id, tasks)| StageSpec { id: (*id).into(), tasks: tasks.iter().map(|t| (*t).into()).collect() })
            .collect(),
    }
}

pub fn standard_process() -> Process {
    define_process(standard_spec()).expect("표준 공정 정의는 항상 유효합니다")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_six_stages_and_twenty_five_tasks() {
        let process = standard_process();
        assert_eq!(process.stages().len(), 6);
        assert_eq!(process.task_count(), 25);
    }
}
