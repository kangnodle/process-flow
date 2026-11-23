use process_flow_domain::workflow::{Evidence, FileEvidence, LinkEvidence, ReviewStatus, TaskDocument, TaskRecord};

#[test]
fn variant_metadata_is_searchable_without_exposing_file_bytes() {
    let file = Evidence::File(FileEvidence {
        id: "file".into(),
        title: "Result".into(),
        description: "Reviewed".into(),
        file_name: "result.txt".into(),
        media_type: None,
        size: 1,
        base64: "YQ==".into(),
    });
    let link = Evidence::Link(LinkEvidence {
        id: "link".into(),
        title: "Reference".into(),
        description: "Source".into(),
        url: "https://example.com".into(),
    });
    let record = TaskRecord {
        evidence: Some(vec![file, link]),
        document: Some(TaskDocument { version: 1, answers: Default::default(), review_status: ReviewStatus::Passed }),
        ..Default::default()
    };
    assert_eq!(record.searchable_text(), "Result\nReviewed\nReference\nSource");
}
