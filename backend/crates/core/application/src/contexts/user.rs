use process_flow_domain::user::{User, UserPatch, ensure_admin_remains};

use crate::error::{AppResult, ApplicationError};

#[derive(Debug)]
pub struct UserUpdateContext<'a> {
    pub user: &'a User,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserUpdatePlan {
    pub user: User,
    pub check_administrators: bool,
    pub end_sessions: bool,
}

impl UserUpdatePlan {
    pub fn validate_administrators(&self, users: &[User]) -> AppResult<()> {
        if self.check_administrators {
            ensure_admin_remains(users, &self.user)?;
        }
        Ok(())
    }
}

impl UserUpdateContext<'_> {
    pub fn plan(&self, patch: &UserPatch, expected_version: Option<u64>) -> AppResult<Option<UserUpdatePlan>> {
        if let Some(expected) = expected_version.filter(|version| *version != self.user.version) {
            return Err(ApplicationError::VersionConflict { expected });
        }
        Ok(self.user.apply(patch)?.map(|user| UserUpdatePlan {
            check_administrators: user.active != self.user.active || user.is_admin != self.user.is_admin,
            end_sessions: !user.active,
            user,
        }))
    }
}
