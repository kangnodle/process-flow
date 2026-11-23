use process_flow_domain::UserId;
use process_flow_domain::membership::{Membership, Permission, Role, ensure_owner_remains};
use process_flow_domain::user::User;

use crate::error::{AppResult, ApplicationError};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MembershipChange {
    Unchanged,
    Save { release_execution: bool },
}

#[derive(Debug)]
pub struct MembershipContext<'a> {
    pub members: &'a [Membership],
    pub user: &'a User,
}

impl MembershipContext<'_> {
    pub fn put(&self, role: Role) -> AppResult<MembershipChange> {
        let existing = self.members.iter().find(|member| member.user_id == self.user.id);
        if existing.is_none() && !self.user.active {
            return Err(ApplicationError::Conflict(format!(
                "비활성 사용자는 멤버로 넣을 수 없습니다: {}",
                self.user.id
            )));
        }
        if existing.is_some_and(|member| member.role == role) {
            return Ok(MembershipChange::Unchanged);
        }
        ensure_owner_remains(self.members, &self.user.id, Some(role))?;
        Ok(MembershipChange::Save { release_execution: existing.is_some() && !role.allows(Permission::ExecuteCommand) })
    }

    pub fn remove(&self) -> AppResult<()> {
        plan_member_removal(self.members, &self.user.id)
    }
}

pub fn plan_member_removal(members: &[Membership], user_id: &UserId) -> AppResult<()> {
    if !members.iter().any(|member| &member.user_id == user_id) {
        return Err(ApplicationError::NotFound { entity: "프로젝트 멤버", id: user_id.to_string() });
    }
    ensure_owner_remains(members, user_id, None)?;
    Ok(())
}
