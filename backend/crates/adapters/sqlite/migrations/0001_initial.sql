CREATE TABLE processes (
    id TEXT PRIMARY KEY
) STRICT;

CREATE TABLE stages (
    process_id TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (process_id, id),
    UNIQUE (process_id, position)
) STRICT;

CREATE TABLE tasks (
    process_id TEXT NOT NULL,
    id TEXT NOT NULL,
    stage_id TEXT NOT NULL,
    number INTEGER NOT NULL CHECK (number > 0),
    PRIMARY KEY (process_id, id),
    UNIQUE (process_id, number),
    FOREIGN KEY (process_id, stage_id) REFERENCES stages(process_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX tasks_stage ON tasks (process_id, stage_id, number);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
    version INTEGER NOT NULL CHECK (version >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    is_admin INTEGER NOT NULL CHECK (is_admin IN (0, 1)),
    version INTEGER NOT NULL CHECK (version >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX active_admins ON users (id) WHERE active = 1 AND is_admin = 1;

CREATE TABLE credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE auth_setup (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
    token_digest TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_by_user ON sessions (user_id);
CREATE INDEX sessions_by_expiry ON sessions (expires_at_ms);

CREATE TABLE memberships (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id)
) STRICT;
CREATE INDEX memberships_by_user ON memberships (user_id, created_at_ms);

CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    process_id TEXT NOT NULL REFERENCES processes(id),
    name TEXT NOT NULL,
    phase_kind TEXT NOT NULL CHECK (phase_kind IN ('working', 'awaitingApproval', 'finished')),
    phase_stage INTEGER NOT NULL CHECK (phase_stage >= 0),
    phase_completed INTEGER NOT NULL CHECK (phase_completed >= 0),
    rework_until INTEGER CHECK (rework_until > 0),
    rework_reason TEXT,
    version INTEGER NOT NULL CHECK (version >= 0),
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK ((rework_until IS NULL) = (rework_reason IS NULL))
) STRICT;
CREATE INDEX workflows_by_project ON workflows (project_id, created_at_ms DESC);
CREATE INDEX workflows_by_creation ON workflows (created_at_ms DESC);

CREATE TABLE task_records (
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    link TEXT NOT NULL,
    note TEXT NOT NULL,
    document TEXT CHECK (document IS NULL OR json_type(document) = 'object'),
    evidence TEXT CHECK (evidence IS NULL OR json_type(evidence) = 'array'),
    search_text TEXT NOT NULL,
    search_revision INTEGER CHECK (search_revision > 0),
    PRIMARY KEY (workflow_id, task_id),
    CHECK ((search_text = '') = (search_revision IS NULL))
) STRICT;
CREATE INDEX searchable_task_records ON task_records (workflow_id, task_id) WHERE search_revision IS NOT NULL;

CREATE TABLE workflow_events (
    id INTEGER PRIMARY KEY,
    source_id TEXT UNIQUE,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 0),
    occurred_at_ms INTEGER NOT NULL,
    actor_id TEXT REFERENCES users(id),
    authority TEXT CHECK (authority IN ('assigned', 'open', 'override')),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL CHECK (json_type(payload) = 'object')
) STRICT;
CREATE INDEX workflow_events_by_workflow ON workflow_events (workflow_id, version);

CREATE TABLE workflow_assignments (
    workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 0),
    content TEXT NOT NULL CHECK (json_type(content) = 'object'),
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE assignment_changes (
    id INTEGER PRIMARY KEY,
    source_id TEXT UNIQUE,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK (version >= 0),
    changed_by TEXT NOT NULL REFERENCES users(id),
    changed_at_ms INTEGER NOT NULL,
    content TEXT NOT NULL CHECK (json_type(content) = 'object')
) STRICT;
CREATE INDEX assignment_changes_by_workflow ON assignment_changes (workflow_id, version);

CREATE TABLE workflow_preferences (
    workflow_id TEXT PRIMARY KEY REFERENCES workflows(id) ON DELETE CASCADE,
    locale TEXT CHECK (locale IN ('ko', 'en')),
    theme TEXT CHECK (theme IN ('system', 'light', 'dark')),
    view TEXT CHECK (view IN ('stage', 'task', 'board')),
    selected_task_id TEXT,
    updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE search_revision (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    value INTEGER NOT NULL CHECK (value >= 0)
) STRICT;
INSERT INTO search_revision (singleton, value) VALUES (1, 0);

CREATE TABLE search_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    text TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 4294967295),
    available_at_ms INTEGER NOT NULL DEFAULT 0,
    UNIQUE (workflow_id, task_id)
) STRICT;
CREATE INDEX search_jobs_due ON search_jobs (available_at_ms, id);
