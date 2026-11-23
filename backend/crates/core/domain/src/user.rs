use crate::error::DomainError;
use crate::ids::UserId;

pub const USER_NAME_MAX_CHARS: usize = 100;
pub const EMAIL_MAX_CHARS: usize = 254;
pub const PASSWORD_MIN_CHARS: usize = 8;
pub const PASSWORD_MAX_CHARS: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub user_id: UserId,
    pub is_admin: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: UserId,
    pub email: String,
    pub name: String,
    pub active: bool,
    pub is_admin: bool,
    pub version: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserPatch {
    pub email: Option<String>,
    pub name: Option<String>,
    pub active: Option<bool>,
    pub is_admin: Option<bool>,
}

pub fn validate_password(password: &str) -> Result<(), DomainError> {
    let length = password.chars().count();
    if length < PASSWORD_MIN_CHARS {
        return Err(DomainError::InvalidPassword(format!("{PASSWORD_MIN_CHARS}자 이상이어야 합니다")));
    }
    if length > PASSWORD_MAX_CHARS {
        return Err(DomainError::InvalidPassword(format!("{PASSWORD_MAX_CHARS}자 이하여야 합니다")));
    }
    Ok(())
}

pub fn ensure_admin_remains(users: &[User], changed: &User) -> Result<(), DomainError> {
    let is_active_admin = |user: &User| user.active && user.is_admin;
    let had_admin = users.iter().any(is_active_admin);
    let admin_after = users.iter().any(|user| is_active_admin(if user.id == changed.id { changed } else { user }));
    if had_admin && !admin_after { Err(DomainError::LastAdmin) } else { Ok(()) }
}

pub fn normalize_email(email: &str) -> Result<String, DomainError> {
    let email = email.trim().to_lowercase();
    let invalid = || DomainError::InvalidUser(format!("이메일 형식이 올바르지 않습니다: {email}"));
    if email.chars().count() > EMAIL_MAX_CHARS {
        return Err(DomainError::InvalidUser(format!("이메일은 {EMAIL_MAX_CHARS}자 이하여야 합니다")));
    }
    let (local, domain) = email.split_once('@').ok_or_else(invalid)?;
    let well_formed = !local.is_empty()
        && !domain.contains('@')
        && !email.chars().any(char::is_whitespace)
        && domain.split('.').count() >= 2
        && domain.split('.').all(|label| !label.is_empty());
    if !well_formed {
        return Err(invalid());
    }
    Ok(email)
}

fn normalize_name(name: &str) -> Result<String, DomainError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DomainError::InvalidUser("이름이 비어 있습니다".into()));
    }
    if name.chars().count() > USER_NAME_MAX_CHARS {
        return Err(DomainError::InvalidUser(format!("이름은 {USER_NAME_MAX_CHARS}자 이하여야 합니다")));
    }
    Ok(name.to_owned())
}

impl User {
    pub fn create(id: UserId, email: &str, name: &str) -> Result<Self, DomainError> {
        Ok(Self {
            id,
            email: normalize_email(email)?,
            name: normalize_name(name)?,
            active: true,
            is_admin: false,
            version: 0,
        })
    }

    pub fn actor(&self) -> Actor {
        Actor { user_id: self.id.clone(), is_admin: self.is_admin }
    }

    pub fn apply(&self, patch: &UserPatch) -> Result<Option<Self>, DomainError> {
        let email = patch.email.as_deref().map(normalize_email).transpose()?.unwrap_or_else(|| self.email.clone());
        let name = patch.name.as_deref().map(normalize_name).transpose()?.unwrap_or_else(|| self.name.clone());
        let active = patch.active.unwrap_or(self.active);
        let is_admin = patch.is_admin.unwrap_or(self.is_admin);
        if email == self.email && name == self.name && active == self.active && is_admin == self.is_admin {
            return Ok(None);
        }
        Ok(Some(Self { email, name, active, is_admin, version: self.version + 1, ..self.clone() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_is_normalized_and_checked() {
        assert_eq!(
            match normalize_email("  Kim@Example.COM ") {
                Ok(value) => value,
                Err(error) => panic!("expected normalize_email to succeed: {error:?}"),
            },
            "kim@example.com"
        );
        for bad in
            ["", "kim", "@example.com", "kim@", "kim@example", "kim@@example.com", "k im@example.com", "kim@.com"]
        {
            assert!(normalize_email(bad).is_err(), "{bad}");
        }
        let long = format!("{}@example.com", "a".repeat(EMAIL_MAX_CHARS));
        assert!(normalize_email(&long).is_err());
    }

    #[test]
    fn create_and_apply() {
        let user = match User::create("u1".into(), "Kim@Example.com", " 김개발 ") {
            Ok(value) => value,
            Err(error) => panic!("expected User::create to succeed: {error:?}"),
        };
        assert_eq!((user.email.as_str(), user.name.as_str(), user.active), ("kim@example.com", "김개발", true));
        assert!(User::create("u".into(), "a@b.co", "  ").is_err());

        assert_eq!(
            match user.apply(&UserPatch::default()) {
                Ok(value) => value,
                Err(error) => panic!("expected apply to succeed: {error:?}"),
            },
            None
        );
        assert_eq!(
            match user.apply(&UserPatch { email: Some("KIM@example.com".into()), ..Default::default() }) {
                Ok(value) => value,
                Err(error) => panic!("expected apply to succeed: {error:?}"),
            },
            None
        );
        let inactive = match match user.apply(&UserPatch { active: Some(false), ..Default::default() }) {
            Ok(value) => value,
            Err(error) => panic!("expected apply to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert!(!inactive.active);
        assert_eq!(inactive.version, 1);
        assert!(user.apply(&UserPatch { email: Some("nope".into()), ..Default::default() }).is_err());

        assert!(!user.is_admin);
        let admin = match match user.apply(&UserPatch { is_admin: Some(true), ..Default::default() }) {
            Ok(value) => value,
            Err(error) => panic!("expected apply to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(admin.actor(), Actor { user_id: "u1".into(), is_admin: true });
    }

    #[test]
    fn password_length_is_checked() {
        assert!(validate_password("1234567").is_err());
        assert!(validate_password("12345678").is_ok());
        assert!(validate_password("비밀번호여덟글자").is_ok());
        assert!(validate_password(&"a".repeat(PASSWORD_MAX_CHARS + 1)).is_err());
    }

    #[test]
    fn last_active_admin_is_kept() {
        let patch = |user: &User, patch: UserPatch| match match user.apply(&patch) {
            Ok(value) => value,
            Err(error) => panic!("expected apply to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        let member = match User::create("u1".into(), "a@b.co", "가") {
            Ok(value) => value,
            Err(error) => panic!("expected User::create to succeed: {error:?}"),
        };
        let admin = patch(
            &match User::create("u2".into(), "c@d.co", "나") {
                Ok(value) => value,
                Err(error) => panic!("expected User::create to succeed: {error:?}"),
            },
            UserPatch { is_admin: Some(true), ..Default::default() },
        );
        let demoted = patch(&admin, UserPatch { is_admin: Some(false), ..Default::default() });
        let inactive = patch(&admin, UserPatch { active: Some(false), ..Default::default() });

        assert_eq!(ensure_admin_remains(std::slice::from_ref(&member), &member), Ok(()));
        let users = vec![member.clone(), admin.clone()];
        assert_eq!(ensure_admin_remains(&users, &demoted), Err(DomainError::LastAdmin));
        assert_eq!(ensure_admin_remains(&users, &inactive), Err(DomainError::LastAdmin));
        assert_eq!(
            ensure_admin_remains(&users, &patch(&admin, UserPatch { name: Some("다".into()), ..Default::default() })),
            Ok(())
        );
        let second = patch(&member, UserPatch { is_admin: Some(true), ..Default::default() });
        assert_eq!(ensure_admin_remains(&[second, admin], &demoted), Ok(()));
    }
}
