from strictdoc.core.project_config import ProjectConfig


def create_config() -> ProjectConfig:
    return ProjectConfig(
        project_title="Process Flow",
        project_features=[
            "REQUIREMENT_TO_SOURCE_TRACEABILITY",
            "TRACEABILITY_MATRIX_SCREEN",
        ],
        include_doc_paths=["**.sdoc"],
        source_root_path="..",
        include_source_paths=[
            "backend/apps/**/*.rs",
            "backend/crates/**/*.rs",
            "backend/crates/**/*.sql",
            "backend/Cargo.toml",
            "frontend/apps/**/*.ts",
            "frontend/apps/**/*.tsx",
            "frontend/packages/**/*.ts",
            "frontend/packages/**/*.tsx",
            "frontend/package.json",
            "contracts/*.json",
            "tools/**/*.mjs",
        ],
        exclude_source_paths=["**/node_modules/**", "**/target/**", "**/dist/**"],
    )
