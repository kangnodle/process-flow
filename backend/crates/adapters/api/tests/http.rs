use actix_web::cookie::{Cookie, SameSite};
use actix_web::dev::ServiceResponse;
use actix_web::http::StatusCode;
use actix_web::{App, test, web};
use process_flow_api::{ApiState, CookieSettings, SESSION_COOKIE, configure};
use process_flow_domain::process::standard::standard_spec;
use process_flow_testing::{InMemoryServices, in_memory_services};
use serde_json::{Value, json};

const ADMIN_EMAIL: &str = "root@example.com";
const PASSWORD: &str = "password1";

fn api_state(services: &InMemoryServices) -> ApiState {
    ApiState {
        auth: services.auth.clone(),
        cookies: CookieSettings::default(),
        processes: services.processes.clone(),
        projects: services.projects.clone(),
        users: services.users.clone(),
        memberships: services.memberships.clone(),
        assignments: services.assignments.clone(),
        work: services.work.clone(),
        workflows: services.workflows.clone(),
        search: services.search.clone(),
    }
}

async fn fresh_services() -> InMemoryServices {
    let services = in_memory_services();
    match services.processes.install(standard_spec()).await {
        Ok(value) => value,
        Err(error) => panic!("expected install to succeed: {error:?}"),
    };
    services
}

async fn services() -> InMemoryServices {
    let services = fresh_services().await;
    let grant = match services.auth.setup(ADMIN_EMAIL, "관리자", PASSWORD).await {
        Ok(value) => value,
        Err(error) => panic!("expected setup to succeed: {error:?}"),
    };
    assert_eq!(grant.token, "token1");
    services
}

fn admin_cookie() -> Cookie<'static> {
    session_cookie("token1")
}

fn session_cookie(token: &str) -> Cookie<'static> {
    Cookie::new(SESSION_COOKIE, token.to_owned())
}

fn set_cookie<B>(response: &ServiceResponse<B>) -> Option<Cookie<'static>> {
    response.response().cookies().find(|cookie| cookie.name() == SESSION_COOKIE).map(Cookie::into_owned)
}

macro_rules! app {
    () => {
        app!(services().await)
    };
    ($services:expr) => {
        test::init_service(App::new().app_data(web::Data::new(api_state(&$services))).configure(configure)).await
    };
}

macro_rules! project {
    ($app:expr) => {{
        let project: Value = test::call_and_read_body_json(
            &$app,
            test::TestRequest::post().uri("/api/v1/projects").set_json(json!({ "name": "테스트" })).cookie(admin_cookie()).to_request(),
        )
        .await;
        match project["id"].as_str() {
            Some(id) => id,
            None => panic!("expected project id to be a string"),
        }.to_owned()
    }};
}

fn valid_document(task: &str) -> Value {
    let answers: std::collections::BTreeMap<_, _> = process_flow_domain::workflow::task_form(task)
        .iter()
        .map(|field| (field.id, "Verified requirement outcome"))
        .collect();
    json!({"version": 1, "answers": answers, "reviewStatus": "passed"})
}

macro_rules! save_document {
    ($app:expr, $uri:expr, $task:expr, $cookie:expr) => {{
        let saved = test::call_service(&$app, test::TestRequest::post().uri(&format!("{}/commands", $uri)).cookie($cookie.clone()).set_json(json!({"command": {"type": "updateRecord", "taskId": $task, "patch": {"document": valid_document($task)}}})).to_request()).await;
        assert_eq!(saved.status(), StatusCode::OK);
    }};
}

#[actix_web::test]
async fn health_and_process_structure() {
    let app = app!();
    let health: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/health").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(health, json!({ "status": "ok" }));

    let process: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/api/v1/processes/standard").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(
        match process["stages"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        6
    );
    assert_eq!(process["stages"][0]["tasks"][0], json!({ "id": "goals", "number": 1 }));

    let missing = test::call_service(
        &app,
        test::TestRequest::get().uri("/api/v1/processes/nope").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn workflow_lifecycle_over_http() {
    let services = services().await;
    let app = app!(services);
    let orphan = test::call_service(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .set_json(json!({ "name": "데모" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(orphan.status(), StatusCode::BAD_REQUEST);
    let none: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/api/v1/workflows").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(none, json!([]));

    let project_id = project!(app);
    let created = test::call_service(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .set_json(json!({ "projectId": project_id, "name": "데모" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let workflow: Value = test::read_body_json(created).await;
    let id = match workflow["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();
    assert_eq!(workflow["projectId"], project_id.as_str());
    assert_eq!(workflow["unlockedStage"], 0);
    assert_eq!(workflow["phase"], json!({ "kind": "working", "stageIndex": 0, "completed": 0 }));
    assert_eq!(workflow["progress"]["total"], 25);

    let command = |body: Value| {
        test::TestRequest::post()
            .uri(&format!("/api/v1/workflows/{id}/commands"))
            .set_json(body)
            .cookie(admin_cookie())
            .to_request()
    };

    let locked =
        test::call_service(&app, command(json!({ "command": { "type": "completeTask", "taskId": "wireframes" } })))
            .await;
    assert_eq!(locked.status(), StatusCode::CONFLICT);
    let body: Value = test::read_body_json(locked).await;
    assert_eq!(body["error"]["code"], "ruleViolation");
    assert_eq!(body["error"]["details"]["kind"], "stageLocked");

    let skipped: Value = test::call_and_read_body_json(
        &app,
        command(json!({ "command": { "type": "completeTask", "taskId": "user-research" } })),
    )
    .await;
    assert_eq!(
        skipped["error"]["details"],
        json!({ "kind": "outOfOrder", "taskId": "user-research", "expected": "goals" })
    );

    save_document!(app, format!("/api/v1/workflows/{id}"), "goals", admin_cookie());
    let ok: Value = test::call_and_read_body_json(
        &app,
        command(json!({ "expectedVersion": 1, "command": { "type": "completeAndNext", "taskId": "goals" } })),
    )
    .await;
    assert_eq!(ok["changed"], true);
    assert_eq!(
        ok["events"][0],
        json!({ "type": "taskCompleted", "taskId": "goals", "record": {"link": "", "note": "", "document": valid_document("goals")} })
    );
    assert_eq!(ok["workflow"]["version"], 2);
    assert_eq!(ok["workflow"]["done"], json!(["goals"]));
    assert_eq!(ok["workflow"]["phase"], json!({ "kind": "working", "stageIndex": 0, "completed": 1 }));
    assert_eq!(ok["workflow"]["rework"], Value::Null);

    let stale = test::call_service(
        &app,
        command(json!({ "expectedVersion": 0, "command": { "type": "reopenTask", "taskId": "goals" } })),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);

    let redo: Value = test::call_and_read_body_json(
        &app,
        command(json!({ "command": { "type": "requestRework", "taskId": "goals", "reason": "KPI 재정의" } })),
    )
    .await;
    assert_eq!(redo["workflow"]["phase"], json!({ "kind": "working", "stageIndex": 0, "completed": 0 }));
    assert_eq!(redo["workflow"]["rework"], json!({ "untilNumber": 2, "reason": "KPI 재정의" }));
    assert_eq!(redo["events"][0]["type"], "reworkRequested");

    let _: Value = test::call_and_read_body_json(
        &app,
        command(json!({ "command": { "type": "updateRecord", "taskId": "goals", "patch": { "note": "kpi kpi" } } })),
    )
    .await;
    services.index_pending().await;
    let found: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get()
            .uri(&format!("/api/v1/search/records?q=kpi&workflowId={id}"))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(found["hits"][0]["taskId"], "goals");

    let detail: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri(&format!("/api/v1/workflows/{id}")).cookie(admin_cookie()).to_request(),
    )
    .await;
    let mut document = valid_document("goals");
    document["reviewStatus"] = json!("pending");
    assert_eq!(detail["records"]["goals"], json!({ "link": "", "note": "kpi kpi", "document": document }));

    let list: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/api/v1/workflows").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(
        match list.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
}

#[actix_web::test]
async fn malformed_requests_use_error_envelope() {
    let app = app!();
    let bad = test::call_service(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows/x/commands")
            .set_json(json!({ "command": { "type": "fly" } }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(bad.status(), StatusCode::BAD_REQUEST);
    let body: Value = test::read_body_json(bad).await;
    assert_eq!(body["error"]["code"], "badRequest");

    let empty = test::call_service(
        &app,
        test::TestRequest::get().uri("/api/v1/search/records?q=%20").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(empty.status(), StatusCode::BAD_REQUEST);

    let prerequisites: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get()
            .uri("/api/v1/processes/standard/tasks/wireframes/prerequisites")
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(
        match prerequisites["prerequisites"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        7
    );
}

#[actix_web::test]
async fn preferences_are_patched_per_field_and_validated() {
    let app = app!();
    let project_id = project!(app);
    let workflow: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .set_json(json!({ "projectId": project_id }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    let uri = format!(
        "/api/v1/workflows/{}/preferences",
        match workflow["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );

    let empty: Value =
        test::call_and_read_body_json(&app, test::TestRequest::get().uri(&uri).cookie(admin_cookie()).to_request())
            .await;
    assert_eq!(empty, json!({ "locale": null, "theme": null, "view": null, "selectedTaskId": null }));

    let patch = |body: Value| test::TestRequest::patch().uri(&uri).set_json(body).cookie(admin_cookie()).to_request();
    let first: Value = test::call_and_read_body_json(&app, patch(json!({ "locale": "en", "theme": "dark" }))).await;
    assert_eq!(first["locale"], "en");
    let second: Value =
        test::call_and_read_body_json(&app, patch(json!({ "view": "task", "selectedTaskId": "wireframes" }))).await;
    assert_eq!(second, json!({ "locale": "en", "theme": "dark", "view": "task", "selectedTaskId": "wireframes" }));
    let reloaded: Value =
        test::call_and_read_body_json(&app, test::TestRequest::get().uri(&uri).cookie(admin_cookie()).to_request())
            .await;
    assert_eq!(reloaded, second);

    for bad in [json!({ "theme": "neon" }), json!({ "selectedTaskId": "nope" }), json!({ "extra": 1 })] {
        let response = test::call_service(&app, patch(bad)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    let missing = test::call_service(
        &app,
        test::TestRequest::get().uri("/api/v1/workflows/none/preferences").cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn project_crud_and_project_workflows_over_http() {
    let app = app!();
    let get = |uri: &str| test::TestRequest::get().uri(uri).cookie(admin_cookie()).to_request();

    let initial: Value = test::call_and_read_body_json(&app, get("/api/v1/projects")).await;
    assert_eq!(initial, json!([]));
    let other_id = project!(app);

    let created = test::call_service(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/projects")
            .set_json(json!({ "name": " 결제 개편 ", "description": "2분기" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let location = match match created.headers().get("Location") {
        Some(value) => value,
        None => panic!("expected get to be present"),
    }
    .to_str()
    {
        Ok(value) => value,
        Err(error) => panic!("expected Location header text to be valid: {error:?}"),
    }
    .to_owned();
    let project: Value = test::read_body_json(created).await;
    let id = match project["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();
    assert_eq!(location, format!("/api/v1/projects/{id}"));
    assert_eq!(project["name"], "결제 개편");
    let uri = format!("/api/v1/projects/{id}");
    let detail: Value = test::call_and_read_body_json(&app, get(&uri)).await;
    assert_eq!(detail, project);

    let patch = |body: Value| test::TestRequest::patch().uri(&uri).set_json(body).cookie(admin_cookie()).to_request();
    let renamed: Value =
        test::call_and_read_body_json(&app, patch(json!({ "expectedVersion": 0, "name": "결제 2.0" }))).await;
    assert_eq!((renamed["name"].as_str(), renamed["version"].as_u64()), (Some("결제 2.0"), Some(1)));
    let stale = test::call_service(&app, patch(json!({ "expectedVersion": 0, "name": "x" }))).await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    for bad in [json!({ "name": "  " }), json!({ "owner": "me" })] {
        assert_eq!(test::call_service(&app, patch(bad)).await.status(), StatusCode::BAD_REQUEST);
    }

    let workflows_uri = format!("{uri}/workflows");
    let started = test::call_service(
        &app,
        test::TestRequest::post()
            .uri(&workflows_uri)
            .set_json(json!({ "name": "웹" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(started.status(), StatusCode::CREATED);
    let workflow: Value = test::read_body_json(started).await;
    assert_eq!(workflow["projectId"], id.as_str());
    let _: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .set_json(json!({ "projectId": other_id, "name": "다른" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;

    let in_project: Value = test::call_and_read_body_json(&app, get(&workflows_uri)).await;
    assert_eq!(
        match in_project.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
    assert_eq!(in_project[0]["id"], workflow["id"]);
    let filtered: Value = test::call_and_read_body_json(&app, get(&format!("/api/v1/workflows?projectId={id}"))).await;
    assert_eq!(filtered, in_project);
    let all: Value = test::call_and_read_body_json(&app, get("/api/v1/workflows")).await;
    assert_eq!(
        match all.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        2
    );

    let body_project = test::call_service(
        &app,
        test::TestRequest::post()
            .uri(&workflows_uri)
            .set_json(json!({ "projectId": other_id }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!(body_project.status(), StatusCode::BAD_REQUEST);
    let missing = test::call_service(&app, get("/api/v1/projects/nope/workflows")).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);

    let archived: Value =
        test::call_and_read_body_json(&app, test::TestRequest::delete().uri(&uri).cookie(admin_cookie()).to_request())
            .await;
    assert_eq!(archived["archived"], true);
    let active: Value = test::call_and_read_body_json(&app, get("/api/v1/projects")).await;
    assert_eq!(
        match active.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
    let everything: Value = test::call_and_read_body_json(&app, get("/api/v1/projects?includeArchived=true")).await;
    assert_eq!(
        match everything.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        2
    );
    let blocked = test::call_service(
        &app,
        test::TestRequest::post().uri(&workflows_uri).set_json(json!({})).cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(blocked.status(), StatusCode::CONFLICT);
    let body: Value = test::read_body_json(blocked).await;
    assert_eq!(body["error"]["code"], "conflict");

    let workflow_id = match workflow["id"].as_str() {
        Some(id) => id,
        None => panic!("expected workflow id to be a string"),
    };
    let workflow_uri = format!("/api/v1/workflows/{workflow_id}");
    let viewed: Value = test::call_and_read_body_json(&app, get(&workflow_uri)).await;
    assert_eq!(viewed["projectArchived"], true);
    assert_eq!(viewed["role"], "owner");
    assert_eq!(viewed["permissions"], json!(["project.view"]));
    assert!(viewed["authority"]["tasks"]["goals"].is_null());

    let preferences_uri = format!("{workflow_uri}/preferences");
    let assignments_uri = format!("{workflow_uri}/assignments");
    for uri in [&preferences_uri, &assignments_uri] {
        assert_eq!(test::call_service(&app, get(uri)).await.status(), StatusCode::OK);
    }
    for request in [
        test::TestRequest::post()
            .uri(&format!("{workflow_uri}/commands"))
            .set_json(json!({ "command": { "type": "completeTask", "taskId": "goals" } })),
        test::TestRequest::patch().uri(&preferences_uri).set_json(json!({ "view": "task" })),
        test::TestRequest::put().uri(&assignments_uri).set_json(json!({ "stages": [], "tasks": [] })),
    ] {
        let response = test::call_service(&app, request.cookie(admin_cookie()).to_request()).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    let restored: Value = test::call_and_read_body_json(&app, patch(json!({ "archived": false }))).await;
    assert_eq!(restored["archived"], false);
    let viewed: Value = test::call_and_read_body_json(&app, get(&workflow_uri)).await;
    assert_eq!(viewed["projectArchived"], false);
    assert_eq!(viewed["permissions"], workflow["permissions"]);
    save_document!(app, workflow_uri, "goals", admin_cookie());
    let preferences = test::TestRequest::patch()
        .uri(&preferences_uri)
        .set_json(json!({ "view": "task" }))
        .cookie(admin_cookie())
        .to_request();
    assert_eq!(test::call_service(&app, preferences).await.status(), StatusCode::OK);

    let other: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::delete().uri(&format!("/api/v1/projects/{other_id}")).cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(other["archived"], true);
    let missing = test::call_service(&app, get("/api/v1/projects/nope")).await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn users_and_members_over_http() {
    let app = app!();
    let get = |uri: &str| test::TestRequest::get().uri(uri).cookie(admin_cookie()).to_request();
    let post_user =
        |body: Value| test::TestRequest::post().uri("/api/v1/users").set_json(body).cookie(admin_cookie()).to_request();

    let created = test::call_service(
        &app,
        post_user(json!({ "email": " Kim@Example.com ", "name": "김개발", "password": PASSWORD })),
    )
    .await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let kim: Value = test::read_body_json(created).await;
    assert_eq!((kim["email"].as_str(), kim["active"].as_bool()), (Some("kim@example.com"), Some(true)));
    assert_eq!(kim["isAdmin"], false);
    assert!(!kim.to_string().contains("assword"), "{kim}");
    let kim_id = match kim["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();
    let lee: Value = test::call_and_read_body_json(
        &app,
        post_user(json!({ "email": "lee@example.com", "name": "이디자인", "password": PASSWORD })),
    )
    .await;
    let lee_id = match lee["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();

    let duplicate =
        test::call_service(&app, post_user(json!({ "email": "KIM@example.com", "name": "x", "password": PASSWORD })))
            .await;
    assert_eq!(duplicate.status(), StatusCode::CONFLICT);
    for bad in [
        json!({ "email": "nope", "name": "x", "password": PASSWORD }),
        json!({ "email": "a@b.co", "name": "x" }),
        json!({ "email": "a@b.co", "name": "x", "password": "short" }),
        json!({ "email": "a@b.co", "name": "x", "password": PASSWORD, "role": "admin" }),
    ] {
        assert_eq!(test::call_service(&app, post_user(bad)).await.status(), StatusCode::BAD_REQUEST);
    }

    let user_uri = format!("/api/v1/users/{lee_id}");
    let renamed: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::patch()
            .uri(&user_uri)
            .set_json(json!({ "expectedVersion": 0, "name": "이디자이너" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    assert_eq!((renamed["name"].as_str(), renamed["version"].as_u64()), (Some("이디자이너"), Some(1)));

    let project: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/projects")
            .set_json(json!({ "name": "결제 개편" }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    let members_uri = format!(
        "/api/v1/projects/{}/members",
        match project["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let put = |user: &str, role: &str| {
        test::TestRequest::put()
            .uri(&format!("{members_uri}/{user}"))
            .set_json(json!({ "role": role }))
            .cookie(admin_cookie())
            .to_request()
    };
    let owner: Value = test::call_and_read_body_json(&app, put(&kim_id, "owner")).await;
    assert_eq!(owner["role"], "owner");
    assert_eq!(owner["user"]["id"], kim_id.as_str());
    let initial: Value = test::call_and_read_body_json(&app, get(&members_uri)).await;
    assert_eq!(initial[0]["role"], "owner");
    assert_eq!(initial[0]["user"]["email"], ADMIN_EMAIL);
    let admin_id = match initial[0]["user"]["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();
    let left = test::call_service(
        &app,
        test::TestRequest::delete().uri(&format!("{members_uri}/{admin_id}")).cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(left.status(), StatusCode::NO_CONTENT);
    let _: Value = test::call_and_read_body_json(&app, put(&lee_id, "viewer")).await;
    let _: Value = test::call_and_read_body_json(&app, put(&lee_id, "editor")).await;
    let members: Value = test::call_and_read_body_json(&app, get(&members_uri)).await;
    assert_eq!(
        match members.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .iter()
        .map(|m| (
            match m["user"]["name"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            },
            match m["role"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            }
        ))
        .collect::<Vec<_>>(),
        vec![("김개발", "owner"), ("이디자이너", "editor")]
    );

    assert_eq!(test::call_service(&app, put(&lee_id, "admin")).await.status(), StatusCode::BAD_REQUEST);
    assert_eq!(test::call_service(&app, put("nope", "viewer")).await.status(), StatusCode::NOT_FOUND);
    let remove = |user: &str| {
        test::TestRequest::delete().uri(&format!("{members_uri}/{user}")).cookie(admin_cookie()).to_request()
    };
    let last = test::call_service(&app, remove(&kim_id)).await;
    assert_eq!(last.status(), StatusCode::CONFLICT);
    let body: Value = test::read_body_json(last).await;
    assert_eq!(body["error"]["code"], "conflict");
    assert_eq!(test::call_service(&app, put(&kim_id, "viewer")).await.status(), StatusCode::CONFLICT);

    let removed = test::call_service(&app, remove(&lee_id)).await;
    assert_eq!(removed.status(), StatusCode::NO_CONTENT);
    assert_eq!(test::call_service(&app, remove(&lee_id)).await.status(), StatusCode::NOT_FOUND);

    let kim_projects: Value =
        test::call_and_read_body_json(&app, get(&format!("/api/v1/users/{kim_id}/projects"))).await;
    assert_eq!(
        match kim_projects.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
    assert_eq!(kim_projects[0]["role"], "owner");
    assert_eq!(kim_projects[0]["project"]["name"], "결제 개편");

    let deactivated: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::delete().uri(&user_uri).cookie(admin_cookie()).to_request(),
    )
    .await;
    assert_eq!(deactivated["active"], false);
    let active: Value = test::call_and_read_body_json(&app, get("/api/v1/users")).await;
    assert_eq!(
        match active.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        2
    );
    let all: Value = test::call_and_read_body_json(&app, get("/api/v1/users?includeInactive=true")).await;
    assert_eq!(
        match all.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        3
    );
    assert_eq!(test::call_service(&app, put(&lee_id, "viewer")).await.status(), StatusCode::CONFLICT);
    assert_eq!(test::call_service(&app, get("/api/v1/users/nope")).await.status(), StatusCode::NOT_FOUND);
}

#[actix_web::test]
async fn everything_but_health_and_auth_needs_a_session() {
    let app = app!();
    let health = test::call_service(&app, test::TestRequest::get().uri("/health").to_request()).await;
    assert_eq!(health.status(), StatusCode::OK);

    let protected = [
        test::TestRequest::get().uri("/api/v1/processes/standard"),
        test::TestRequest::get().uri("/api/v1/projects"),
        test::TestRequest::post().uri("/api/v1/projects").set_json(json!({ "name": "x" })),
        test::TestRequest::get().uri("/api/v1/users"),
        test::TestRequest::post().uri("/api/v1/users").set_json(json!({ "email": "a@b.co", "name": "x" })),
        test::TestRequest::get().uri("/api/v1/workflows"),
        test::TestRequest::post().uri("/api/v1/workflows/x/commands").set_json(json!({})),
        test::TestRequest::get().uri("/api/v1/search/records?q=kpi"),
        test::TestRequest::get().uri("/api/v1/nope"),
    ];
    for request in protected {
        let request = request.to_request();
        let uri = request.uri().to_string();
        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{uri}");
        let body: Value = test::read_body_json(response).await;
        assert_eq!(body["error"]["code"], "unauthenticated", "{uri}");
    }

    let stale = test::call_service(
        &app,
        test::TestRequest::get().uri("/api/v1/projects").cookie(session_cookie("nope")).to_request(),
    )
    .await;
    assert_eq!(stale.status(), StatusCode::UNAUTHORIZED);
    let cleared = set_cookie(&stale).expect("지우는 쿠키");
    assert_eq!((cleared.value(), cleared.max_age().map(|age| age.whole_seconds())), ("", Some(0)));
}

#[actix_web::test]
async fn first_visitor_sets_up_the_admin_then_setup_closes() {
    let app = app!(fresh_services().await);
    let status = || test::TestRequest::get().uri("/api/v1/auth/status");
    let post = |path: &str, body: Value| test::TestRequest::post().uri(path).set_json(body).to_request();

    let before: Value = test::call_and_read_body_json(&app, status().to_request()).await;
    assert_eq!(before, json!({ "setupRequired": true, "user": null }));
    let closed = test::call_service(&app, test::TestRequest::get().uri("/api/v1/users").to_request()).await;
    assert_eq!(closed.status(), StatusCode::UNAUTHORIZED);

    for bad in [
        json!({ "email": "nope", "name": "관리자", "password": PASSWORD }),
        json!({ "email": ADMIN_EMAIL, "name": "관리자", "password": "short" }),
        json!({ "email": ADMIN_EMAIL, "name": "관리자" }),
    ] {
        assert_eq!(test::call_service(&app, post("/api/v1/auth/setup", bad)).await.status(), StatusCode::BAD_REQUEST);
    }

    let setup = json!({ "email": ADMIN_EMAIL, "name": "관리자", "password": PASSWORD });
    let created = test::call_service(&app, post("/api/v1/auth/setup", setup.clone())).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let cookie = set_cookie(&created).expect("세션 쿠키");
    assert_eq!(cookie.http_only(), Some(true));
    assert_eq!(cookie.same_site(), Some(SameSite::Lax));
    assert_eq!(cookie.path(), Some("/"));
    assert_eq!(cookie.max_age().map(|age| age.whole_days()), Some(7));
    let admin: Value = test::read_body_json(created).await;
    assert_eq!((admin["email"].as_str(), admin["isAdmin"].as_bool()), (Some(ADMIN_EMAIL), Some(true)));

    let after: Value = test::call_and_read_body_json(&app, status().cookie(cookie.clone()).to_request()).await;
    assert_eq!(after, json!({ "setupRequired": false, "user": admin }));
    let anonymous: Value = test::call_and_read_body_json(&app, status().to_request()).await;
    assert_eq!(anonymous, json!({ "setupRequired": false, "user": null }));

    let again = test::call_service(
        &app,
        post("/api/v1/auth/setup", json!({ "email": "evil@example.com", "name": "x", "password": PASSWORD })),
    )
    .await;
    assert_eq!(again.status(), StatusCode::CONFLICT);
    assert!(set_cookie(&again).is_none());
    let users: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/api/v1/users?includeInactive=true").cookie(cookie).to_request(),
    )
    .await;
    assert_eq!(
        match users.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
}

#[actix_web::test]
async fn login_logout_and_password_change_over_http() {
    let app = app!();
    let post = |path: &str, body: Value| test::TestRequest::post().uri(path).set_json(body);
    let projects =
        |cookie: &Cookie<'static>| test::TestRequest::get().uri("/api/v1/projects").cookie(cookie.clone()).to_request();

    for (email, password) in [(ADMIN_EMAIL, "wrong-password"), ("nobody@example.com", PASSWORD)] {
        let failed = test::call_service(
            &app,
            post("/api/v1/auth/login", json!({ "email": email, "password": password })).to_request(),
        )
        .await;
        assert_eq!(failed.status(), StatusCode::UNAUTHORIZED);
        assert!(set_cookie(&failed).is_none());
        let body: Value = test::read_body_json(failed).await;
        assert_eq!(body["error"]["code"], "invalidCredentials");
    }

    let login = json!({ "email": " ROOT@example.com ", "password": PASSWORD });
    let ok = test::call_service(&app, post("/api/v1/auth/login", login.clone()).to_request()).await;
    assert_eq!(ok.status(), StatusCode::OK);
    let first = set_cookie(&ok).expect("세션 쿠키");
    let other = match set_cookie(&test::call_service(&app, post("/api/v1/auth/login", login).to_request()).await) {
        Some(value) => value,
        None => panic!("expected set_cookie to be present"),
    };
    assert_ne!(first.value(), other.value());
    assert_eq!(test::call_service(&app, projects(&first)).await.status(), StatusCode::OK);

    let change = |current: &str, new: &str| {
        post("/api/v1/auth/password", json!({ "currentPassword": current, "newPassword": new }))
    };
    assert_eq!(test::call_service(&app, change(PASSWORD, "password2").to_request()).await.status(), 401);
    let wrong = change("wrong-password", "password2").cookie(first.clone()).to_request();
    assert_eq!(test::call_service(&app, wrong).await.status(), StatusCode::BAD_REQUEST);
    let changed = change(PASSWORD, "password2").cookie(first.clone()).to_request();
    assert_eq!(test::call_service(&app, changed).await.status(), StatusCode::NO_CONTENT);
    assert_eq!(test::call_service(&app, projects(&first)).await.status(), StatusCode::OK);
    assert_eq!(test::call_service(&app, projects(&other)).await.status(), StatusCode::UNAUTHORIZED);
    let old = post("/api/v1/auth/login", json!({ "email": ADMIN_EMAIL, "password": PASSWORD })).to_request();
    assert_eq!(test::call_service(&app, old).await.status(), StatusCode::UNAUTHORIZED);

    let logout = || test::TestRequest::post().uri("/api/v1/auth/logout");
    let out = test::call_service(&app, logout().cookie(first.clone()).to_request()).await;
    assert_eq!(out.status(), StatusCode::NO_CONTENT);
    assert_eq!(set_cookie(&out).map(|cookie| cookie.value().to_owned()), Some(String::new()));
    assert_eq!(test::call_service(&app, projects(&first)).await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(test::call_service(&app, logout().to_request()).await.status(), StatusCode::NO_CONTENT);
}

#[actix_web::test]
async fn repeated_login_failures_get_429() {
    let app = app!();
    let login = |password: &str| {
        test::TestRequest::post()
            .uri("/api/v1/auth/login")
            .set_json(json!({ "email": ADMIN_EMAIL, "password": password }))
            .to_request()
    };
    for _ in 0..10 {
        assert_eq!(test::call_service(&app, login("wrong-password")).await.status(), StatusCode::UNAUTHORIZED);
    }
    let blocked = test::call_service(&app, login(PASSWORD)).await;
    assert_eq!(blocked.status(), StatusCode::TOO_MANY_REQUESTS);
    let body: Value = test::read_body_json(blocked).await;
    assert_eq!(body["error"]["code"], "tooManyAttempts");
}

#[actix_web::test]
async fn only_admins_manage_users_over_http() {
    let app = app!();
    let kim: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/users")
            .set_json(json!({ "email": "kim@example.com", "name": "김개발", "password": PASSWORD }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    let kim_id = match kim["id"].as_str() {
        Some(value) => value,
        None => panic!("expected as_str to be present"),
    }
    .to_owned();
    let login = |password: &str| {
        test::TestRequest::post()
            .uri("/api/v1/auth/login")
            .set_json(json!({ "email": "kim@example.com", "password": password }))
            .to_request()
    };
    let member = set_cookie(&test::call_service(&app, login(PASSWORD)).await).expect("세션 쿠키");

    let listed =
        test::call_service(&app, test::TestRequest::get().uri("/api/v1/users").cookie(member.clone()).to_request())
            .await;
    assert_eq!(listed.status(), StatusCode::OK);
    let user_uri = format!("/api/v1/users/{kim_id}");
    let forbidden = [
        test::TestRequest::post().uri("/api/v1/users").set_json(json!({
            "email": "lee@example.com", "name": "이디자인", "password": PASSWORD
        })),
        test::TestRequest::patch().uri(&user_uri).set_json(json!({ "isAdmin": true })),
        test::TestRequest::delete().uri(&user_uri),
        test::TestRequest::put().uri(&format!("{user_uri}/password")).set_json(json!({ "password": "password2" })),
    ];
    for request in forbidden {
        let response = test::call_service(&app, request.cookie(member.clone()).to_request()).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body: Value = test::read_body_json(response).await;
        assert_eq!(body["error"]["code"], "forbidden");
    }

    let set = test::TestRequest::put()
        .uri(&format!("{user_uri}/password"))
        .set_json(json!({ "password": "password2" }))
        .cookie(admin_cookie())
        .to_request();
    assert_eq!(test::call_service(&app, set).await.status(), StatusCode::NO_CONTENT);
    let ended =
        test::call_service(&app, test::TestRequest::get().uri("/api/v1/users").cookie(member).to_request()).await;
    assert_eq!(ended.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(test::call_service(&app, login(PASSWORD)).await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(test::call_service(&app, login("password2")).await.status(), StatusCode::OK);

    let admins: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::get().uri("/api/v1/users").cookie(admin_cookie()).to_request(),
    )
    .await;
    let admin_uri = format!(
        "/api/v1/users/{}",
        match admins[0]["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let patch =
        |uri: &str, body: Value| test::TestRequest::patch().uri(uri).set_json(body).cookie(admin_cookie()).to_request();
    let last = test::call_service(&app, patch(&admin_uri, json!({ "isAdmin": false }))).await;
    assert_eq!(last.status(), StatusCode::CONFLICT);
    let promoted: Value = test::call_and_read_body_json(&app, patch(&user_uri, json!({ "isAdmin": true }))).await;
    assert_eq!(promoted["isAdmin"], true);
    let demoted: Value = test::call_and_read_body_json(&app, patch(&admin_uri, json!({ "isAdmin": false }))).await;
    assert_eq!(demoted["isAdmin"], false);
}

#[actix_web::test]
async fn commands_record_the_actor_and_sessions_slide() {
    let services = services().await;
    let app = app!(services);
    let project_id = project!(app);
    let workflow: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .set_json(json!({ "projectId": project_id }))
            .cookie(admin_cookie())
            .to_request(),
    )
    .await;
    save_document!(
        app,
        format!(
            "/api/v1/workflows/{}",
            match workflow["id"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            }
        ),
        "goals",
        admin_cookie()
    );
    let command = test::TestRequest::post()
        .uri(&format!(
            "/api/v1/workflows/{}/commands",
            match workflow["id"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            }
        ))
        .set_json(json!({ "command": { "type": "completeTask", "taskId": "goals" } }))
        .cookie(admin_cookie())
        .to_request();
    let done = test::call_service(&app, command).await;
    assert_eq!(done.status(), StatusCode::OK);
    assert!(set_cookie(&done).is_none());

    let admin_id = match services.users.list(true).await {
        Ok(value) => value,
        Err(error) => panic!("expected list to succeed: {error:?}"),
    }[0]
    .id
    .clone();
    let actors: Vec<_> = match services.store.events.lock() {
        Ok(value) => value,
        Err(error) => panic!("expected lock to succeed: {error:?}"),
    }
    .iter()
    .map(|event| event.actor.clone())
    .collect();
    assert_eq!(actors, vec![admin_id.clone(), admin_id]);

    services.clock.advance(2 * 60 * 60 * 1000);
    let later =
        test::call_service(&app, test::TestRequest::get().uri("/api/v1/projects").cookie(admin_cookie()).to_request())
            .await;
    assert_eq!(later.status(), StatusCode::OK);
    let renewed = set_cookie(&later).expect("늦춘 쿠키");
    assert_eq!((renewed.value(), renewed.max_age().map(|age| age.whole_days())), ("token1", Some(7)));
}

macro_rules! member {
    ($app:expr, $name:expr) => {{
        let email = format!("{}@example.com", $name);
        let created: Value = test::call_and_read_body_json(
            &$app,
            test::TestRequest::post()
                .uri("/api/v1/users")
                .set_json(json!({ "email": email, "name": $name, "password": PASSWORD }))
                .cookie(admin_cookie())
                .to_request(),
        )
        .await;
        let login = test::call_service(
            &$app,
            test::TestRequest::post()
                .uri("/api/v1/auth/login")
                .set_json(json!({ "email": email, "password": PASSWORD }))
                .to_request(),
        )
        .await;
        (match created["id"].as_str() {
            Some(id) => id,
            None => panic!("expected created id to be a string"),
        }.to_owned(), set_cookie(&login).expect("세션 쿠키"))
    }};
}

#[actix_web::test]
async fn project_roles_decide_what_each_member_can_do() {
    let app = app!();
    let (owner_id, owner) = member!(app, "owner");
    let (editor_id, editor) = member!(app, "editor");
    let (viewer_id, viewer) = member!(app, "viewer");
    let (outsider_id, outsider) = member!(app, "outsider");
    let as_user = |request: test::TestRequest, cookie: &Cookie<'static>| request.cookie(cookie.clone()).to_request();

    let project: Value = test::call_and_read_body_json(
        &app,
        as_user(test::TestRequest::post().uri("/api/v1/projects").set_json(json!({ "name": "결제 개편" })), &owner),
    )
    .await;
    assert_eq!(project["role"], "owner");
    assert_eq!(
        project["permissions"],
        json!([
            "project.view",
            "workflow.start",
            "workflow.execute",
            "preferences.save",
            "project.edit",
            "members.manage",
            "assignments.manage"
        ])
    );
    let project_uri = format!(
        "/api/v1/projects/{}",
        match project["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let member_uri = |user: &str| format!("{project_uri}/members/{user}");
    for (user, role) in [(&editor_id, "editor"), (&viewer_id, "viewer")] {
        let put = test::TestRequest::put().uri(&member_uri(user)).set_json(json!({ "role": role }));
        assert_eq!(test::call_service(&app, as_user(put, &owner)).await.status(), StatusCode::OK);
    }
    let members: Value = test::call_and_read_body_json(
        &app,
        as_user(test::TestRequest::get().uri(&format!("{project_uri}/members")), &viewer),
    )
    .await;
    assert_eq!(
        match members.as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        3
    );
    assert_eq!(members[0]["user"]["id"], owner_id.as_str());

    let seen = |cookie: &Cookie<'static>| as_user(test::TestRequest::get().uri(&project_uri), cookie);
    let as_editor: Value = test::call_and_read_body_json(&app, seen(&editor)).await;
    assert_eq!(as_editor["role"], "editor");
    assert_eq!(
        as_editor["permissions"],
        json!(["project.view", "workflow.start", "workflow.execute", "preferences.save"])
    );
    let as_viewer: Value = test::call_and_read_body_json(&app, seen(&viewer)).await;
    assert_eq!((as_viewer["role"].as_str(), &as_viewer["permissions"]), (Some("viewer"), &json!(["project.view"])));
    let as_admin: Value = test::call_and_read_body_json(&app, seen(&admin_cookie())).await;
    assert_eq!(as_admin["role"], "owner");

    let started: Value = test::call_and_read_body_json(
        &app,
        as_user(test::TestRequest::post().uri(&format!("{project_uri}/workflows")).set_json(json!({})), &editor),
    )
    .await;
    assert_eq!(started["role"], "editor");
    let workflow_uri = format!(
        "/api/v1/workflows/{}",
        match started["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let complete = || {
        test::TestRequest::post()
            .uri(&format!("{workflow_uri}/commands"))
            .set_json(json!({ "command": { "type": "completeTask", "taskId": "goals" } }))
    };
    save_document!(app, workflow_uri, "goals", editor);
    let done: Value = test::call_and_read_body_json(&app, as_user(complete(), &editor)).await;
    assert_eq!(done["changed"], true);
    assert_eq!(done["workflow"]["permissions"], as_editor["permissions"]);

    let forbidden_for_editor = [
        test::TestRequest::patch().uri(&project_uri).set_json(json!({ "name": "x" })),
        test::TestRequest::delete().uri(&project_uri),
        test::TestRequest::put().uri(&member_uri(&outsider_id)).set_json(json!({ "role": "viewer" })),
        test::TestRequest::put().uri(&member_uri(&editor_id)).set_json(json!({ "role": "owner" })),
        test::TestRequest::delete().uri(&member_uri(&viewer_id)),
    ];
    for request in forbidden_for_editor {
        let response = test::call_service(&app, as_user(request, &editor)).await;
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let body: Value = test::read_body_json(response).await;
        assert_eq!(body["error"]["code"], "forbidden");
    }

    let readable = [
        project_uri.clone(),
        format!("{project_uri}/workflows"),
        workflow_uri.clone(),
        format!("{workflow_uri}/preferences"),
        "/api/v1/workflows".to_owned(),
        "/api/v1/search/records?q=kpi".to_owned(),
    ];
    for uri in &readable {
        let response = test::call_service(&app, as_user(test::TestRequest::get().uri(uri), &viewer)).await;
        assert_eq!(response.status(), StatusCode::OK, "{uri}");
    }
    let viewed: Value =
        test::call_and_read_body_json(&app, as_user(test::TestRequest::get().uri(&workflow_uri), &viewer)).await;
    assert_eq!((viewed["role"].as_str(), &viewed["permissions"]), (Some("viewer"), &json!(["project.view"])));
    let forbidden_for_viewer = [
        complete(),
        test::TestRequest::post().uri(&format!("{project_uri}/workflows")).set_json(json!({})),
        test::TestRequest::patch().uri(&format!("{workflow_uri}/preferences")).set_json(json!({ "theme": "dark" })),
    ];
    for request in forbidden_for_viewer {
        assert_eq!(test::call_service(&app, as_user(request, &viewer)).await.status(), StatusCode::FORBIDDEN);
    }

    let hidden = [
        test::TestRequest::get().uri(&project_uri),
        test::TestRequest::get().uri(&format!("{project_uri}/members")),
        test::TestRequest::get().uri(&format!("{project_uri}/workflows")),
        test::TestRequest::get().uri(&workflow_uri),
        test::TestRequest::get().uri(&format!(
            "/api/v1/search/records?q=kpi&workflowId={}",
            match started["id"].as_str() {
                Some(value) => value,
                None => panic!("expected as_str to be present"),
            }
        )),
        complete(),
        test::TestRequest::delete().uri(&project_uri),
        test::TestRequest::put().uri(&member_uri(&outsider_id)).set_json(json!({ "role": "owner" })),
    ];
    for request in hidden {
        let response = test::call_service(&app, as_user(request, &outsider)).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let body: Value = test::read_body_json(response).await;
        assert_eq!(body["error"]["code"], "notFound");
    }
    for uri in ["/api/v1/projects?includeArchived=true", "/api/v1/workflows"] {
        let list: Value =
            test::call_and_read_body_json(&app, as_user(test::TestRequest::get().uri(uri), &outsider)).await;
        assert_eq!(list, json!([]), "{uri}");
    }

    let own = format!("/api/v1/users/{viewer_id}/projects");
    let mine: Value = test::call_and_read_body_json(&app, as_user(test::TestRequest::get().uri(&own), &viewer)).await;
    assert_eq!((mine[0]["role"].as_str(), mine[0]["project"]["role"].as_str()), (Some("viewer"), Some("viewer")));
    assert_eq!(
        test::call_service(&app, as_user(test::TestRequest::get().uri(&own), &editor)).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        test::call_service(&app, as_user(test::TestRequest::get().uri(&own), &admin_cookie())).await.status(),
        StatusCode::OK
    );
}

#[actix_web::test]
async fn assignments_decide_who_runs_each_task_and_stage() {
    let app = app!();
    let (owner_id, owner) = member!(app, "owner");
    let (editor_id, editor) = member!(app, "editor");
    let (other_id, other) = member!(app, "other");
    let (viewer_id, viewer) = member!(app, "viewer");
    let (outsider_id, outsider) = member!(app, "outsider");
    let as_user = |request: test::TestRequest, cookie: &Cookie<'static>| request.cookie(cookie.clone()).to_request();

    let project: Value = test::call_and_read_body_json(
        &app,
        as_user(test::TestRequest::post().uri("/api/v1/projects").set_json(json!({ "name": "결제 개편" })), &owner),
    )
    .await;
    let project_uri = format!(
        "/api/v1/projects/{}",
        match project["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    for (user, role) in [(&editor_id, "editor"), (&other_id, "editor"), (&viewer_id, "viewer")] {
        let put =
            test::TestRequest::put().uri(&format!("{project_uri}/members/{user}")).set_json(json!({ "role": role }));
        assert_eq!(test::call_service(&app, as_user(put, &owner)).await.status(), StatusCode::OK);
    }
    let started: Value = test::call_and_read_body_json(
        &app,
        as_user(test::TestRequest::post().uri(&format!("{project_uri}/workflows")).set_json(json!({})), &owner),
    )
    .await;
    assert_eq!(started["assignments"], json!({ "version": 0, "stages": [], "tasks": [] }));
    assert_eq!(started["authority"]["tasks"]["goals"], "open");
    assert_eq!(started["authority"]["stages"]["planning"], "open");
    let workflow_uri = format!(
        "/api/v1/workflows/{}",
        match started["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let assignments_uri = format!("{workflow_uri}/assignments");
    let get = |uri: &str| test::TestRequest::get().uri(uri);
    let put = |body: Value| test::TestRequest::put().uri(&assignments_uri).set_json(body);

    let body = json!({
        "expectedVersion": 0,
        "stages": [{ "stageId": "planning", "accountable": owner_id, "responsible": [editor_id], "consulted": [viewer_id] }],
        "tasks": [{ "taskId": "goals", "responsible": [other_id] }],
    });
    let saved: Value = test::call_and_read_body_json(&app, as_user(put(body.clone()), &owner)).await;
    assert_eq!(saved["version"], 1);
    assert_eq!(
        saved["stages"],
        json!([{
            "stageId": "planning",
            "accountable": owner_id,
            "responsible": [editor_id],
            "consulted": [viewer_id],
            "informed": [],
        }])
    );
    assert_eq!(saved["tasks"], json!([{ "taskId": "goals", "responsible": [other_id] }]));
    let read: Value = test::call_and_read_body_json(&app, as_user(get(&assignments_uri), &viewer)).await;
    assert_eq!(read, saved);

    assert_eq!(test::call_service(&app, as_user(put(body.clone()), &editor)).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(test::call_service(&app, as_user(put(body.clone()), &outsider)).await.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        test::call_service(&app, as_user(get(&assignments_uri), &outsider)).await.status(),
        StatusCode::NOT_FOUND
    );
    let stale = test::call_service(&app, as_user(put(json!({ "expectedVersion": 0, "stages": [] })), &owner)).await;
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    for bad in [
        json!({ "tasks": [{ "taskId": "goals", "responsible": [outsider_id] }] }),
        json!({ "tasks": [{ "taskId": "goals", "responsible": [viewer_id] }] }),
        json!({ "tasks": [{ "taskId": "nope", "responsible": [editor_id] }] }),
        json!({ "stages": [{ "stageId": "nope", "accountable": owner_id }] }),
        json!({ "stages": [{ "stageId": "planning" }, { "stageId": "planning" }] }),
        json!({ "stages": [{ "stageId": "planning", "owner": owner_id }] }),
    ] {
        let response = test::call_service(&app, as_user(put(bad.clone()), &owner)).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{bad}");
    }

    let authority = |cookie: &Cookie<'static>| as_user(get(&workflow_uri), cookie);
    let for_editor: Value = test::call_and_read_body_json(&app, authority(&editor)).await;
    assert_eq!(for_editor["authority"]["tasks"]["goals"], Value::Null);
    assert_eq!(for_editor["authority"]["tasks"]["user-research"], "assigned");
    assert_eq!(for_editor["authority"]["stages"]["planning"], Value::Null);
    assert_eq!(for_editor["authority"]["stages"]["design"], "open");
    assert_eq!(for_editor["assignments"], saved);
    let for_other: Value = test::call_and_read_body_json(&app, authority(&other)).await;
    assert_eq!(for_other["authority"]["tasks"]["goals"], "assigned");
    assert_eq!(for_other["authority"]["tasks"]["user-research"], Value::Null);
    let for_owner: Value = test::call_and_read_body_json(&app, authority(&owner)).await;
    assert_eq!(for_owner["authority"]["tasks"]["goals"], "override");
    assert_eq!(for_owner["authority"]["stages"]["planning"], "assigned");
    let for_viewer: Value = test::call_and_read_body_json(&app, authority(&viewer)).await;
    assert_eq!(for_viewer["authority"]["tasks"]["goals"], Value::Null);
    assert_eq!(for_viewer["authority"]["stages"]["design"], Value::Null);

    let command = |body: Value| test::TestRequest::post().uri(&format!("{workflow_uri}/commands")).set_json(body);
    let complete = |task: &str| command(json!({ "command": { "type": "completeTask", "taskId": task } }));
    let denied = test::call_service(&app, as_user(complete("goals"), &editor)).await;
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    let denied: Value = test::read_body_json(denied).await;
    assert_eq!(denied["error"]["code"], "forbidden");
    save_document!(app, workflow_uri, "goals", other);
    save_document!(app, workflow_uri, "user-research", owner);
    let done: Value = test::call_and_read_body_json(&app, as_user(complete("goals"), &other)).await;
    assert_eq!(done["changed"], true);
    assert_eq!(done["workflow"]["authority"]["tasks"]["goals"], "assigned");
    let overridden = test::call_service(&app, as_user(complete("user-research"), &owner)).await;
    assert_eq!(overridden.status(), StatusCode::OK);
    let rework = || command(json!({ "command": { "type": "requestRework", "taskId": "goals", "reason": "다시" } }));
    assert_eq!(test::call_service(&app, as_user(rework(), &other)).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(test::call_service(&app, as_user(rework(), &owner)).await.status(), StatusCode::OK);

    let work = |cookie: &Cookie<'static>| as_user(get("/api/v1/me/work"), cookie);
    let for_editor: Value = test::call_and_read_body_json(&app, work(&editor)).await;
    let items = match for_editor["items"].as_array() {
        Some(value) => value,
        None => panic!("expected as_array to be present"),
    };
    assert_eq!(items.len(), 6, "{for_editor}");
    assert_eq!(
        items[0],
        json!({
            "projectId": project["id"],
            "projectName": "결제 개편",
            "workflowId": started["id"],
            "workflowName": "새 워크플로",
            "group": "waiting",
            "kind": "task",
            "stageId": "planning",
            "stageIndex": 0,
            "taskId": "user-research",
            "taskNumber": 2,
            "wait": { "kind": "afterTasks", "remaining": 1 },
            "rework": true,
        })
    );
    let for_other: Value = test::call_and_read_body_json(&app, work(&other)).await;
    assert_eq!(
        match for_other["items"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
    let mine = &for_other["items"][0];
    assert_eq!(
        (mine["group"].as_str(), mine["taskId"].as_str(), &mine["wait"], mine["rework"].as_bool()),
        (Some("ready"), Some("goals"), &Value::Null, Some(true))
    );
    let for_owner: Value = test::call_and_read_body_json(&app, work(&owner)).await;
    assert_eq!(
        match for_owner["items"].as_array() {
            Some(value) => value,
            None => panic!("expected as_array to be present"),
        }
        .len(),
        1
    );
    assert_eq!(
        (for_owner["items"][0]["kind"].as_str(), for_owner["items"][0]["group"].as_str()),
        (Some("approval"), Some("waiting"))
    );
    assert_eq!(for_owner["items"][0]["taskId"], Value::Null);
    let for_viewer: Value = test::call_and_read_body_json(&app, work(&viewer)).await;
    assert_eq!(
        (for_viewer["items"][0]["group"].as_str(), for_viewer["items"][0]["kind"].as_str()),
        (Some("watching"), Some("consulted"))
    );
    assert_eq!(test::call_and_read_body_json::<_, _, Value>(&app, work(&outsider)).await["items"], json!([]));
    let anonymous = test::call_service(&app, get("/api/v1/me/work").to_request()).await;
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);

    let removed = test::TestRequest::delete().uri(&format!("{project_uri}/members/{other_id}"));
    assert_eq!(test::call_service(&app, as_user(removed, &owner)).await.status(), StatusCode::NO_CONTENT);
    let after: Value = test::call_and_read_body_json(&app, as_user(get(&assignments_uri), &owner)).await;
    assert_eq!((after["version"].as_u64(), &after["tasks"]), (Some(2), &json!([])));
    let for_editor: Value = test::call_and_read_body_json(&app, authority(&editor)).await;
    assert_eq!(for_editor["authority"]["tasks"]["goals"], "assigned");
    let _ = outsider_id;
}

#[actix_web::test]
async fn documents_and_file_evidence_enforce_server_gates_access_and_conflicts() {
    let services = services().await;
    let app = app!(services);
    let project_id = project!(app);
    let (viewer_id, viewer) = member!(app, "document-viewer");
    let added = test::call_service(
        &app,
        test::TestRequest::put()
            .uri(&format!("/api/v1/projects/{project_id}/members/{viewer_id}"))
            .cookie(admin_cookie())
            .set_json(json!({"role":"viewer"}))
            .to_request(),
    )
    .await;
    assert_eq!(added.status(), StatusCode::OK);
    let workflow: Value = test::call_and_read_body_json(
        &app,
        test::TestRequest::post()
            .uri("/api/v1/workflows")
            .cookie(admin_cookie())
            .set_json(json!({"projectId":project_id}))
            .to_request(),
    )
    .await;
    let uri = format!(
        "/api/v1/workflows/{}",
        match workflow["id"].as_str() {
            Some(value) => value,
            None => panic!("expected as_str to be present"),
        }
    );
    let post = |command: Value, version: u64, cookie: Cookie<'static>| {
        test::TestRequest::post()
            .uri(&format!("{uri}/commands"))
            .cookie(cookie)
            .set_json(json!({"command":command,"expectedVersion":version}))
            .to_request()
    };
    let complete = json!({"type":"completeTask","taskId":"goals"});
    let missing = test::call_service(&app, post(complete.clone(), 0, admin_cookie())).await;
    assert_eq!(missing.status(), StatusCode::CONFLICT);
    let missing: Value = test::read_body_json(missing).await;
    assert_eq!(missing["error"]["details"]["kind"], "taskDocumentIncomplete");
    let evidence = json!({"id":"file-1","kind":"file","title":"Recorded outcome","description":"Proof","fileName":"result.txt","mediaType":"text/plain","size":75000,"base64":"AAAA".repeat(25000)});
    let evidence_only = json!({"type":"updateRecord","taskId":"goals","patch":{"evidence":[evidence]}});
    assert_eq!(
        test::call_service(&app, post(evidence_only.clone(), 0, viewer.clone())).await.status(),
        StatusCode::FORBIDDEN
    );
    let saved: Value = test::call_and_read_body_json(&app, post(evidence_only, 0, admin_cookie())).await;
    assert_eq!(saved["workflow"]["records"]["goals"]["evidence"][0], evidence);
    assert_eq!(
        test::call_service(&app, post(complete.clone(), 1, admin_cookie())).await.status(),
        StatusCode::CONFLICT
    );
    let read: Value =
        test::call_and_read_body_json(&app, test::TestRequest::get().uri(&uri).cookie(viewer.clone()).to_request())
            .await;
    assert_eq!(read["records"]["goals"]["evidence"][0], evidence);
    assert_eq!(
        test::call_service(&app, test::TestRequest::get().uri(&uri).to_request()).await.status(),
        StatusCode::UNAUTHORIZED
    );
    for patch in [
        json!({"document":{"version":1,"answers":{},"reviewStatus":"unknown"}}),
        json!({"evidence":[{"id":"x","kind":"unknown","title":"x","description":""}]}),
        json!({"evidence":[{"id":"x","kind":"link","title":"x","description":"","url":"https://example.com","base64":"YQ=="}]}),
        json!({"evidence":[{"id":"x","kind":"file","title":"x","description":"","fileName":"result.txt","base64":"YQ=="}]}),
        json!({"evidence":[{"id":"x","kind":"file","title":"x","description":"","fileName":"../x","size":1,"base64":"YQ=="}]}),
        json!({"evidence":[{"id":"x","kind":"file","title":"x","description":"","fileName":"x","size":1,"base64":"YR=="}]}),
        json!({"evidence":[{"id":"x","kind":"link","title":"x","description":"","url":"javascript:alert(1)"}]}),
    ] {
        let bad = json!({"type":"updateRecord","taskId":"goals","patch":patch});
        let forbidden = test::call_service(&app, post(bad.clone(), 1, viewer.clone())).await;
        assert_eq!(forbidden.status(), StatusCode::FORBIDDEN);
        let stale: Value = test::call_and_read_body_json(&app, post(bad.clone(), 0, admin_cookie())).await;
        assert_eq!(stale["error"]["code"], "versionConflict");
        let rejected = test::call_service(&app, post(bad, 1, admin_cookie())).await;
        assert_eq!(rejected.status(), StatusCode::CONFLICT);
        let rejected: Value = test::read_body_json(rejected).await;
        assert_eq!(rejected["error"]["code"], "ruleViolation");
        assert_eq!(rejected["error"]["details"]["kind"], "invalidRecord");
    }
    let mut document = valid_document("goals");
    document["reviewStatus"] = json!("blocked");
    let save = |document: Value| json!({"type":"updateRecord","taskId":"goals","patch":{"document":document}});
    assert_eq!(test::call_service(&app, post(save(document), 1, admin_cookie())).await.status(), StatusCode::OK);
    assert_eq!(
        test::call_service(&app, post(complete.clone(), 2, admin_cookie())).await.status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        test::call_service(&app, post(save(valid_document("goals")), 2, admin_cookie())).await.status(),
        StatusCode::OK
    );
    let remove = json!({"type":"updateRecord","taskId":"goals","patch":{"evidence":[]}});
    assert_eq!(test::call_service(&app, post(remove.clone(), 1, admin_cookie())).await.status(), StatusCode::CONFLICT);
    let done: Value = test::call_and_read_body_json(&app, post(complete, 3, admin_cookie())).await;
    assert_eq!(done["workflow"]["version"], 4);
    assert_eq!(done["events"][0]["record"]["evidence"][0], evidence);
    assert_eq!(test::call_service(&app, post(remove.clone(), 4, admin_cookie())).await.status(), StatusCode::CONFLICT);
    assert_eq!(
        test::call_service(&app, post(json!({"type":"reopenTask","taskId":"goals"}), 4, admin_cookie())).await.status(),
        StatusCode::OK
    );
    let removed: Value = test::call_and_read_body_json(&app, post(remove, 5, admin_cookie())).await;
    assert_eq!(removed["workflow"]["records"]["goals"]["evidence"], json!([]));
    assert_eq!(removed["workflow"]["records"]["goals"]["document"]["reviewStatus"], "pending");
    let events = match services.store.events.lock() {
        Ok(value) => value,
        Err(error) => panic!("expected lock to succeed: {error:?}"),
    };
    let snapshot = match events.iter().find_map(|event| match &event.event {
        process_flow_domain::workflow::Event::TaskCompleted { record, .. } => Some(record),
        _ => None,
    }) {
        Some(value) => value,
        None => panic!("expected find_map to be present"),
    };
    let Some(process_flow_domain::workflow::Evidence::File(file)) =
        snapshot.evidence.as_ref().and_then(|items| items.first())
    else {
        panic!("expected file evidence")
    };
    assert_eq!(file.size, 75000);

    assert!(
        events.iter().all(|event| event.actor == events[0].actor && event.occurred_at_ms == events[0].occurred_at_ms)
    );
}
