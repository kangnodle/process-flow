use process_flow_application::ApplicationError;
use process_flow_application::contexts::membership::{MembershipChange, MembershipContext};
use process_flow_application::contexts::user::UserUpdateContext;
use process_flow_domain::membership::{Membership, Role};
use process_flow_domain::user::{User, UserPatch};

fn user() -> User {
    User {
        id: "admin".into(),
        email: "admin@example.com".into(),
        name: "Admin".into(),
        active: true,
        is_admin: true,
        version: 0,
    }
}

#[test]
fn last_owner_cannot_be_removed_or_demoted() {
    let member = Membership { project_id: "project".into(), user_id: "admin".into(), role: Role::Owner };
    let members = [member];
    let user = user();
    let context = MembershipContext { members: &members, user: &user };
    assert!(matches!(context.remove(), Err(ApplicationError::Conflict(_))));
    assert!(matches!(context.put(Role::Editor), Err(ApplicationError::Conflict(_))));
    assert_eq!(context.put(Role::Owner).unwrap(), MembershipChange::Unchanged);
}

#[test]
fn membership_demotion_explicitly_releases_execution_assignments() {
    let user = user();
    let members = [Membership { project_id: "project".into(), user_id: user.id.clone(), role: Role::Editor }];
    let context = MembershipContext { members: &members, user: &user };
    assert_eq!(context.put(Role::Viewer).unwrap(), MembershipChange::Save { release_execution: true });
}

#[test]
fn stale_user_version_precedes_validation_and_unchanged_user_skips_guard() {
    let user = user();
    let context = UserUpdateContext { user: &user };
    let invalid = UserPatch { name: Some(String::new()), ..Default::default() };
    assert!(matches!(context.plan(&invalid, Some(2)), Err(ApplicationError::VersionConflict { expected: 2 })));
    assert!(context.plan(&UserPatch::default(), None).unwrap().is_none());
    let plan = context.plan(&UserPatch { active: Some(false), ..Default::default() }, None).unwrap().unwrap();
    assert!(plan.check_administrators);
    assert!(plan.end_sessions);
    assert!(plan.validate_administrators(&[user]).is_err());
}
