use process_flow_domain::process::{define_process, standard::standard_spec};
use process_flow_domain::workflow::{Command, Phase, WorkflowState, decide};

#[test]
fn standard_task_cannot_complete_without_document() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    assert!(decide(&process, &WorkflowState::default(), &Command::CompleteTask { task_id: "goals".into() }).is_err());
}

#[test]
fn legacy_completion_cannot_be_approved() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let state = WorkflowState { phase: Phase::AwaitingApproval { stage_index: 0 }, ..Default::default() };
    assert!(decide(&process, &state, &Command::ApproveStage { stage_index: 0 }).is_err());
}

#[test]
fn completed_and_locked_records_reject_edits() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let edit = Command::UpdateRecord {
        task_id: "goals".into(),
        link: None,
        note: Some("change".into()),
        document: None,
        evidence: None,
    };
    let state = WorkflowState { phase: Phase::AwaitingApproval { stage_index: 0 }, ..Default::default() };
    assert!(decide(&process, &state, &edit).is_err());
    let locked = process.stages()[1].tasks[0].id.clone();
    let edit = Command::UpdateRecord {
        task_id: locked,
        link: None,
        note: Some("change".into()),
        document: None,
        evidence: None,
    };
    assert!(decide(&process, &WorkflowState::default(), &edit).is_err());
}

use process_flow_domain::workflow::{
    Decision, Evidence, FileEvidence, LinkEvidence, ReviewStatus, TaskDocument, TaskRecord, task_form,
    validate_task_document,
};

fn filled(task: &str) -> TaskRecord {
    TaskRecord {
        document: Some(TaskDocument {
            version: 1,
            answers: task_form(task)
                .iter()
                .map(|f| (f.id.to_owned(), format!("Verified outcome for {}", f.id)))
                .collect(),
            review_status: process_flow_domain::workflow::ReviewStatus::Passed,
        }),
        ..Default::default()
    }
}

fn file() -> FileEvidence {
    FileEvidence {
        id: "file-1".into(),
        title: "Evidence".into(),
        description: "Reviewed text".into(),
        file_name: "result.txt".into(),
        media_type: Some("text/plain".into()),
        size: 1,
        base64: "YQ==".into(),
    }
}

fn edit(record: TaskRecord) -> Command {
    Command::UpdateRecord {
        task_id: "goals".into(),
        link: None,
        note: None,
        document: record.document,
        evidence: record.evidence,
    }
}

#[test]
fn every_catalog_field_is_required_and_placeholder_or_review_cannot_bypass() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    assert_eq!(process.task_count(), 25);
    let catalog: serde_json::Value =
        match serde_json::from_str(include_str!("../../../../../contracts/task-forms.json")) {
            Ok(value) => value,
            Err(error) => panic!("expected serde_json::from_str to succeed: {error:?}"),
        };
    assert_eq!(
        match catalog.as_object() {
            Some(value) => value,
            None => panic!("expected as_object to be present"),
        }
        .len(),
        process.task_count()
    );
    for task in process.tasks() {
        let fields = task_form(task.id.as_str());
        assert!(!fields.is_empty());
        assert_eq!(
            fields.iter().map(|f| f.id).collect::<Vec<_>>(),
            match catalog[task.id.as_str()].as_array() {
                Some(value) => value,
                None => panic!("expected as_array to be present"),
            }
            .iter()
            .map(|f| match f["id"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            })
            .collect::<Vec<_>>()
        );
        let record = filled(task.id.as_str());
        assert!(validate_task_document(task.id.as_str(), &record).is_empty());
        for field in fields {
            for answer in ["", "  ", "...", "TBD", "n/a", "해당 없음: 제외 사유", "n/a: out of scope"] {
                let mut missing = record.clone();
                match missing.document.as_mut() {
                    Some(value) => value,
                    None => panic!("expected as_mut to be present"),
                }
                .answers
                .insert(field.id.into(), answer.into());
                assert!(
                    validate_task_document(task.id.as_str(), &missing).contains(&field.id.to_owned()),
                    "{} {} {answer}",
                    task.id,
                    field.id
                );
            }
        }
        for review in [ReviewStatus::Pending, ReviewStatus::Blocked] {
            let mut pending = record.clone();
            match pending.document.as_mut() {
                Some(value) => value,
                None => panic!("expected as_mut to be present"),
            }
            .review_status = review;
            assert!(validate_task_document(task.id.as_str(), &pending).contains(&"reviewStatus".into()));
        }
    }
}

#[test]
fn completion_event_keeps_full_document_evidence_snapshot_after_rework() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let mut record = filled("goals");
    record.link = "https://example.com/legacy".into();
    record.note = "Legacy note".into();
    record.evidence = Some(vec![Evidence::File(file())]);
    let state = WorkflowState { records: [("goals".into(), record.clone())].into(), ..Default::default() };
    let Decision::Changed { state: done, events } =
        (match decide(&process, &state, &Command::CompleteTask { task_id: "goals".into() }) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        })
    else {
        panic!()
    };
    assert!(
        matches!(&events[0], process_flow_domain::workflow::Event::TaskCompleted { record: snapshot, .. } if snapshot == &record)
    );
    let Decision::Changed { state: reopened, .. } =
        (match decide(&process, &done, &Command::ReopenTask { task_id: "goals".into() }) {
            Ok(value) => value,
            Err(error) => panic!("expected decide to succeed: {error:?}"),
        })
    else {
        panic!()
    };
    let mut changed = record.clone();
    match changed.document.as_mut() {
        Some(value) => value,
        None => panic!("expected as_mut to be present"),
    }
    .answers
    .insert("problem".into(), "Revised problem".into());
    assert!(decide(&process, &reopened, &edit(changed)).is_ok());
    assert!(
        matches!(&events[0], process_flow_domain::workflow::Event::TaskCompleted { record: snapshot, .. } if snapshot == &record)
    );
}

#[test]
fn invalid_evidence_is_rejected_before_record_mutation() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let mut bad = vec![];
    for encoded in ["%%%%", "YR==", "YQ=", "Y Q==", "YQ==\n"] {
        let mut item = file();
        item.base64 = encoded.into();
        bad.push(Evidence::File(item));
    }
    let mut item = file();
    item.size = 42;
    bad.push(Evidence::File(item));
    let mut item = file();
    item.file_name = "../result.txt".into();
    bad.push(Evidence::File(item));
    let mut item = file();
    item.base64 = "AAAA".repeat((2 * 1024 * 1024) / 3 + 1);
    item.size = 2 * 1024 * 1024 + 1;
    bad.push(Evidence::File(item));
    for url in [
        "javascript:alert(1)",
        "data:text/html,evil",
        "https:///bad",
        "https://example.com\\evil",
        "https://[not-an-ip]/",
    ] {
        bad.push(Evidence::Link(LinkEvidence {
            id: "link".into(),
            title: "Link".into(),
            description: String::new(),
            url: url.into(),
        }));
    }

    for item in bad {
        let record = TaskRecord { evidence: Some(vec![item.clone()]), ..Default::default() };
        assert!(
            decide(&process, &WorkflowState::default(), &edit(record)).is_err(),
            "invalid evidence accepted: {item:?}"
        );
    }
    let record =
        TaskRecord { evidence: Some(vec![Evidence::File(file()), Evidence::File(file())]), ..Default::default() };
    assert!(decide(&process, &WorkflowState::default(), &edit(record)).is_err());
}

#[test]
fn document_answers_are_searchable_but_file_bytes_are_not() {
    let mut record = filled("goals");
    record.evidence = Some(vec![Evidence::File(file())]);
    assert!(record.searchable_text().contains("Verified outcome for problem"));
    assert!(!record.searchable_text().contains("YQ=="));
}

#[test]
fn evidence_edit_invalidates_previous_review_unless_explicitly_reviewed() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let state = WorkflowState { records: [("goals".into(), filled("goals"))].into(), ..Default::default() };
    let command = Command::UpdateRecord {
        task_id: "goals".into(),
        link: None,
        note: None,
        document: None,
        evidence: Some(vec![Evidence::File(file())]),
    };
    let Decision::Changed { state, .. } = (match decide(&process, &state, &command) {
        Ok(value) => value,
        Err(error) => panic!("expected decide to succeed: {error:?}"),
    }) else {
        panic!()
    };
    assert_eq!(
        match state.record(&"goals".into()).document {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        }
        .review_status,
        ReviewStatus::Pending
    );
}

#[test]
fn not_applicable_variants_cannot_bypass_required_content() {
    for answer in ["N/A : reason", "N/A： reason", "N/A - reason", "해당 없음 ： 제외 사유"] {
        let mut record = filled("goals");
        match record.document.as_mut() {
            Some(value) => value,
            None => panic!("expected as_mut to be present"),
        }
        .answers
        .insert("problem".into(), answer.into());
        assert!(validate_task_document("goals", &record).contains(&"problem".into()), "{answer}");
    }
}

#[test]
fn workflow_file_limit_counts_decoded_bytes_and_replacement_does_not_double_count() {
    let process = match define_process(standard_spec()) {
        Ok(value) => value,
        Err(error) => panic!("expected define_process to succeed: {error:?}"),
    };
    let mut large = file();
    large.size = 2 * 1024 * 1024;
    large.base64 = format!("{}AAA=", "AAAA".repeat((2 * 1024 * 1024) / 3));
    let mut state = WorkflowState::default();
    for id in ["goals", "user-research", "constraints", "requirements"] {
        state.records.insert(
            id.into(),
            TaskRecord { evidence: Some(vec![Evidence::File(large.clone())]), ..Default::default() },
        );
    }
    assert!(
        decide(
            &process,
            &state,
            &edit(TaskRecord { evidence: Some(vec![Evidence::File(large)]), ..Default::default() })
        )
        .is_ok()
    );
    let mut added = state.record(&"goals".into());
    match added.evidence.as_mut() {
        Some(value) => value,
        None => panic!("expected as_mut to be present"),
    }
    .push(Evidence::File(FileEvidence { id: "second".into(), ..file() }));
    assert!(decide(&process, &state, &edit(added)).is_err());
    let items: Vec<_> = (0..21).map(|index| Evidence::File(FileEvidence { id: index.to_string(), ..file() })).collect();
    assert!(
        decide(&process, &WorkflowState::default(), &edit(TaskRecord { evidence: Some(items), ..Default::default() }))
            .is_err()
    );
}
