use crate::process::Process;

use super::state::WorkflowState;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Progress {
    pub done: usize,
    pub total: usize,
    pub ratio: f64,
}

impl Progress {
    fn of(done: usize, total: usize) -> Self {
        let ratio = if total == 0 { 0.0 } else { done as f64 / total as f64 };
        Self { done, total, ratio }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StageSummary {
    pub index: usize,
    pub locked: bool,
    pub complete: bool,
    pub progress: Progress,
}

fn count_done_in_stage(process: &Process, state: &WorkflowState, stage_index: usize) -> usize {
    process
        .stage(stage_index)
        .map(|stage| stage.tasks.iter().filter(|task| state.phase.is_done(process, task)).count())
        .unwrap_or(0)
}

pub fn overall_progress(process: &Process, state: &WorkflowState) -> Progress {
    Progress::of(state.phase.completed_count(process), process.task_count())
}

pub fn stage_summaries(process: &Process, state: &WorkflowState) -> Vec<StageSummary> {
    process
        .stages()
        .iter()
        .map(|stage| {
            let done = count_done_in_stage(process, state, stage.index);
            StageSummary {
                index: stage.index,
                locked: state.is_stage_locked(stage.index),
                complete: done == stage.tasks.len(),
                progress: Progress::of(done, stage.tasks.len()),
            }
        })
        .collect()
}
