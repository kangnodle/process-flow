use crate::error::DomainError;
use crate::ids::{ProjectId, UserId};
use crate::user::Actor;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Permission {
    ViewProject,
    StartWorkflow,
    ExecuteCommand,
    SavePreferences,
    EditProject,
    ManageMembers,
    ManageAssignments,
}

impl Permission {
    pub const ALL: &'static [Self] = &[
        Self::ViewProject,
        Self::StartWorkflow,
        Self::ExecuteCommand,
        Self::SavePreferences,
        Self::EditProject,
        Self::ManageMembers,
        Self::ManageAssignments,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::ViewProject => "project.view",
            Self::StartWorkflow => "workflow.start",
            Self::ExecuteCommand => "workflow.execute",
            Self::SavePreferences => "preferences.save",
            Self::EditProject => "project.edit",
            Self::ManageMembers => "members.manage",
            Self::ManageAssignments => "assignments.manage",
        }
    }

    pub fn required_role(self) -> Role {
        match self {
            Self::ViewProject => Role::Viewer,
            Self::StartWorkflow | Self::ExecuteCommand | Self::SavePreferences => Role::Editor,
            Self::EditProject | Self::ManageMembers | Self::ManageAssignments => Role::Owner,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Role {
    Viewer,
    Editor,
    Owner,
}

impl Role {
    pub const ALL: &'static [Self] = &[Self::Owner, Self::Editor, Self::Viewer];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Editor => "editor",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.iter().copied().find(|role| role.as_str() == value)
    }

    pub fn allows(self, permission: Permission) -> bool {
        self >= permission.required_role()
    }

    pub fn permissions(self) -> impl Iterator<Item = Permission> {
        Permission::ALL.iter().copied().filter(move |permission| self.allows(*permission))
    }
}

pub fn effective_role(actor: &Actor, membership: Option<Role>) -> Option<Role> {
    if actor.is_admin { Some(Role::Owner) } else { membership }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Membership {
    pub project_id: ProjectId,
    pub user_id: UserId,
    pub role: Role,
}

pub fn ensure_owner_remains(members: &[Membership], user_id: &UserId, next: Option<Role>) -> Result<(), DomainError> {
    let had_owner = members.iter().any(|m| m.role == Role::Owner);
    let owner_after = |m: &Membership| {
        if &m.user_id == user_id { next == Some(Role::Owner) } else { m.role == Role::Owner }
    };
    if had_owner && !members.iter().any(owner_after) { Err(DomainError::LastOwner) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(user: &str, role: Role) -> Membership {
        Membership { project_id: "p".into(), user_id: user.into(), role }
    }

    #[test]
    fn roles_allow_what_the_table_says() {
        use Permission::*;
        let allowed = |role: Role| role.permissions().collect::<Vec<_>>();
        assert_eq!(allowed(Role::Viewer), vec![ViewProject]);
        assert_eq!(allowed(Role::Editor), vec![ViewProject, StartWorkflow, ExecuteCommand, SavePreferences]);
        assert_eq!(allowed(Role::Owner), Permission::ALL.to_vec());
        assert!(!Role::Viewer.allows(ExecuteCommand));
        assert!(!Role::Editor.allows(ManageMembers));
        let mut names: Vec<_> = Permission::ALL.iter().map(|p| p.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), Permission::ALL.len());
    }

    #[test]
    fn admins_act_as_owner_everywhere() {
        let member = Actor { user_id: "u".into(), is_admin: false };
        let admin = Actor { user_id: "a".into(), is_admin: true };
        assert_eq!(effective_role(&member, None), None);
        assert_eq!(effective_role(&member, Some(Role::Viewer)), Some(Role::Viewer));
        assert_eq!(effective_role(&admin, None), Some(Role::Owner));
        assert_eq!(effective_role(&admin, Some(Role::Viewer)), Some(Role::Owner));
    }

    #[test]
    fn roles_round_trip() {
        for role in Role::ALL {
            assert_eq!(Role::parse(role.as_str()), Some(*role));
        }
        assert_eq!(Role::parse("admin"), None);
        assert!(Role::Owner > Role::Editor && Role::Editor > Role::Viewer);
    }

    #[test]
    fn last_owner_cannot_leave_or_be_demoted() {
        let members = vec![member("a", Role::Owner), member("b", Role::Editor)];
        assert_eq!(ensure_owner_remains(&members, &"a".into(), None), Err(DomainError::LastOwner));
        assert_eq!(ensure_owner_remains(&members, &"a".into(), Some(Role::Editor)), Err(DomainError::LastOwner));
        assert!(ensure_owner_remains(&members, &"a".into(), Some(Role::Owner)).is_ok());
        assert!(ensure_owner_remains(&members, &"b".into(), None).is_ok());

        let two = vec![member("a", Role::Owner), member("b", Role::Owner)];
        assert!(ensure_owner_remains(&two, &"a".into(), None).is_ok());
        let none = vec![member("b", Role::Editor)];
        assert!(ensure_owner_remains(&none, &"b".into(), None).is_ok());
    }
}
