use super::TaskField;

pub(super) const TASK_FORMS: &[(&str, &[TaskField])] = &[
    (
        "goals",
        &[
            TaskField { id: "problem", allow_not_applicable: false },
            TaskField { id: "business-goal", allow_not_applicable: false },
            TaskField { id: "kpi-name", allow_not_applicable: false },
            TaskField { id: "kpi-target", allow_not_applicable: false },
            TaskField { id: "kpi-method", allow_not_applicable: false },
            TaskField { id: "scope-in", allow_not_applicable: false },
            TaskField { id: "scope-out", allow_not_applicable: false },
            TaskField { id: "stakeholders", allow_not_applicable: false },
        ],
    ),
    (
        "user-research",
        &[
            TaskField { id: "participants", allow_not_applicable: false },
            TaskField { id: "methods", allow_not_applicable: false },
            TaskField { id: "needs", allow_not_applicable: false },
            TaskField { id: "pain-points", allow_not_applicable: false },
            TaskField { id: "competitors", allow_not_applicable: false },
            TaskField { id: "findings", allow_not_applicable: false },
        ],
    ),
    (
        "user-modeling",
        &[
            TaskField { id: "personas", allow_not_applicable: false },
            TaskField { id: "scenarios", allow_not_applicable: false },
            TaskField { id: "journey", allow_not_applicable: false },
            TaskField { id: "opportunities", allow_not_applicable: false },
        ],
    ),
    (
        "requirements",
        &[
            TaskField { id: "functional", allow_not_applicable: false },
            TaskField { id: "non-functional", allow_not_applicable: false },
            TaskField { id: "user-stories", allow_not_applicable: false },
            TaskField { id: "priorities", allow_not_applicable: false },
            TaskField { id: "mvp-in", allow_not_applicable: false },
            TaskField { id: "mvp-out", allow_not_applicable: false },
        ],
    ),
    (
        "information-architecture",
        &[
            TaskField { id: "content", allow_not_applicable: false },
            TaskField { id: "screens", allow_not_applicable: false },
            TaskField { id: "hierarchy", allow_not_applicable: false },
            TaskField { id: "navigation", allow_not_applicable: false },
        ],
    ),
    (
        "user-flows",
        &[
            TaskField { id: "entry-exit", allow_not_applicable: false },
            TaskField { id: "happy-path", allow_not_applicable: false },
            TaskField { id: "errors", allow_not_applicable: false },
            TaskField { id: "empty-states", allow_not_applicable: false },
            TaskField { id: "exceptions", allow_not_applicable: false },
        ],
    ),
    (
        "constraints",
        &[
            TaskField { id: "platform", allow_not_applicable: false },
            TaskField { id: "technology", allow_not_applicable: false },
            TaskField { id: "schedule", allow_not_applicable: false },
            TaskField { id: "budget", allow_not_applicable: false },
            TaskField { id: "legal", allow_not_applicable: false },
            TaskField { id: "integrations", allow_not_applicable: false },
        ],
    ),
    (
        "wireframes",
        &[
            TaskField { id: "screen-layouts", allow_not_applicable: false },
            TaskField { id: "elements", allow_not_applicable: false },
            TaskField { id: "connections", allow_not_applicable: false },
            TaskField { id: "review", allow_not_applicable: false },
        ],
    ),
    (
        "prototyping",
        &[
            TaskField { id: "prototype", allow_not_applicable: false },
            TaskField { id: "test-plan", allow_not_applicable: false },
            TaskField { id: "observations", allow_not_applicable: false },
            TaskField { id: "revisions", allow_not_applicable: false },
        ],
    ),
    (
        "visual-design",
        &[
            TaskField { id: "colors", allow_not_applicable: false },
            TaskField { id: "typography", allow_not_applicable: false },
            TaskField { id: "assets", allow_not_applicable: false },
            TaskField { id: "mockups", allow_not_applicable: false },
        ],
    ),
    (
        "design-system",
        &[
            TaskField { id: "tokens", allow_not_applicable: false },
            TaskField { id: "components", allow_not_applicable: false },
            TaskField { id: "states", allow_not_applicable: false },
            TaskField { id: "accessibility", allow_not_applicable: false },
        ],
    ),
    (
        "technical-design",
        &[
            TaskField { id: "architecture", allow_not_applicable: false },
            TaskField { id: "stack", allow_not_applicable: false },
            TaskField { id: "data-model", allow_not_applicable: false },
            TaskField { id: "api", allow_not_applicable: false },
            TaskField { id: "security", allow_not_applicable: false },
        ],
    ),
    (
        "design-handoff",
        &[
            TaskField { id: "specification", allow_not_applicable: false },
            TaskField { id: "spacing", allow_not_applicable: false },
            TaskField { id: "breakpoints", allow_not_applicable: false },
            TaskField { id: "interactions", allow_not_applicable: false },
            TaskField { id: "edge-cases", allow_not_applicable: false },
            TaskField { id: "handoff", allow_not_applicable: false },
        ],
    ),
    (
        "dev-environment",
        &[
            TaskField { id: "repository", allow_not_applicable: false },
            TaskField { id: "branching", allow_not_applicable: false },
            TaskField { id: "conventions", allow_not_applicable: false },
            TaskField { id: "ci-cd", allow_not_applicable: false },
            TaskField { id: "environments", allow_not_applicable: false },
        ],
    ),
    (
        "implementation",
        &[
            TaskField { id: "features", allow_not_applicable: false },
            TaskField { id: "frontend", allow_not_applicable: false },
            TaskField { id: "backend", allow_not_applicable: false },
            TaskField { id: "integration", allow_not_applicable: false },
            TaskField { id: "verification", allow_not_applicable: false },
        ],
    ),
    (
        "unit-testing",
        &[
            TaskField { id: "coverage", allow_not_applicable: false },
            TaskField { id: "results", allow_not_applicable: false },
            TaskField { id: "reviewers", allow_not_applicable: false },
            TaskField { id: "resolutions", allow_not_applicable: false },
        ],
    ),
    (
        "integration-testing",
        &[
            TaskField { id: "interfaces", allow_not_applicable: false },
            TaskField { id: "scenarios", allow_not_applicable: false },
            TaskField { id: "results", allow_not_applicable: false },
            TaskField { id: "defects", allow_not_applicable: false },
        ],
    ),
    (
        "non-functional-testing",
        &[
            TaskField { id: "performance", allow_not_applicable: false },
            TaskField { id: "security", allow_not_applicable: false },
            TaskField { id: "accessibility", allow_not_applicable: false },
            TaskField { id: "compatibility", allow_not_applicable: false },
        ],
    ),
    (
        "acceptance-testing",
        &[
            TaskField { id: "acceptors", allow_not_applicable: false },
            TaskField { id: "criteria", allow_not_applicable: false },
            TaskField { id: "results", allow_not_applicable: false },
            TaskField { id: "signoff", allow_not_applicable: false },
        ],
    ),
    (
        "release-prep",
        &[
            TaskField { id: "infrastructure", allow_not_applicable: false },
            TaskField { id: "observability", allow_not_applicable: false },
            TaskField { id: "backup", allow_not_applicable: false },
            TaskField { id: "rollback", allow_not_applicable: false },
            TaskField { id: "release-plan", allow_not_applicable: false },
            TaskField { id: "store-review", allow_not_applicable: false },
        ],
    ),
    (
        "deployment",
        &[
            TaskField { id: "version", allow_not_applicable: false },
            TaskField { id: "rollout", allow_not_applicable: false },
            TaskField { id: "verification", allow_not_applicable: false },
            TaskField { id: "communication", allow_not_applicable: false },
            TaskField { id: "support", allow_not_applicable: false },
        ],
    ),
    (
        "monitoring",
        &[
            TaskField { id: "signals", allow_not_applicable: false },
            TaskField { id: "response", allow_not_applicable: false },
            TaskField { id: "incidents", allow_not_applicable: false },
            TaskField { id: "patching", allow_not_applicable: false },
        ],
    ),
    (
        "feedback-analysis",
        &[
            TaskField { id: "kpi-results", allow_not_applicable: false },
            TaskField { id: "behavior", allow_not_applicable: false },
            TaskField { id: "feedback", allow_not_applicable: false },
            TaskField { id: "insights", allow_not_applicable: false },
        ],
    ),
    (
        "maintenance",
        &[
            TaskField { id: "issues", allow_not_applicable: false },
            TaskField { id: "changes", allow_not_applicable: false },
            TaskField { id: "verification", allow_not_applicable: false },
            TaskField { id: "change-log", allow_not_applicable: false },
        ],
    ),
    (
        "iteration",
        &[
            TaskField { id: "opportunities", allow_not_applicable: false },
            TaskField { id: "priorities", allow_not_applicable: false },
            TaskField { id: "backlog", allow_not_applicable: false },
            TaskField { id: "next-cycle", allow_not_applicable: false },
        ],
    ),
];
