use crate::error::DomainError;
use crate::ids::ProjectId;

pub const NAME_MAX_CHARS: usize = 100;
pub const DESCRIPTION_MAX_CHARS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub description: String,
    pub archived: bool,
    pub version: u64,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProjectPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub archived: Option<bool>,
}

impl ProjectPatch {
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}

fn normalize_name(name: &str) -> Result<String, DomainError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DomainError::InvalidProject("이름이 비어 있습니다".into()));
    }
    if name.chars().count() > NAME_MAX_CHARS {
        return Err(DomainError::InvalidProject(format!("이름은 {NAME_MAX_CHARS}자 이하여야 합니다")));
    }
    Ok(name.to_owned())
}

fn normalize_description(description: &str) -> Result<String, DomainError> {
    let description = description.trim();
    if description.chars().count() > DESCRIPTION_MAX_CHARS {
        return Err(DomainError::InvalidProject(format!("설명은 {DESCRIPTION_MAX_CHARS}자 이하여야 합니다")));
    }
    Ok(description.to_owned())
}

impl Project {
    pub fn create(id: ProjectId, name: &str, description: Option<&str>) -> Result<Self, DomainError> {
        Ok(Self {
            id,
            name: normalize_name(name)?,
            description: normalize_description(description.unwrap_or_default())?,
            archived: false,
            version: 0,
        })
    }

    pub fn apply(&self, patch: &ProjectPatch) -> Result<Option<Self>, DomainError> {
        let name = patch.name.as_deref().map(normalize_name).transpose()?.unwrap_or_else(|| self.name.clone());
        let description = patch
            .description
            .as_deref()
            .map(normalize_description)
            .transpose()?
            .unwrap_or_else(|| self.description.clone());
        let archived = patch.archived.unwrap_or(self.archived);
        if name == self.name && description == self.description && archived == self.archived {
            return Ok(None);
        }
        Ok(Some(Self { name, description, archived, version: self.version + 1, ..self.clone() }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> Project {
        match Project::create("p1".into(), "  결제 개편  ", None) {
            Ok(value) => value,
            Err(error) => panic!("expected Project::create to succeed: {error:?}"),
        }
    }

    #[test]
    fn create_trims_and_validates() {
        let p = project();
        assert_eq!(p.name, "결제 개편");
        assert_eq!(p.description, "");
        assert!(!p.archived);
        assert!(Project::create("p".into(), "   ", None).is_err());
        assert!(Project::create("p".into(), &"가".repeat(NAME_MAX_CHARS + 1), None).is_err());
        assert!(Project::create("p".into(), &"가".repeat(NAME_MAX_CHARS), None).is_ok());
        assert!(Project::create("p".into(), "a", Some(&"b".repeat(DESCRIPTION_MAX_CHARS + 1))).is_err());
    }

    #[test]
    fn apply_bumps_version_only_when_changed() {
        let p = project();
        assert_eq!(
            match p.apply(&ProjectPatch::default()) {
                Ok(value) => value,
                Err(error) => panic!("expected apply to succeed: {error:?}"),
            },
            None
        );
        assert_eq!(
            match p.apply(&ProjectPatch { name: Some(" 결제 개편 ".into()), ..Default::default() }) {
                Ok(value) => value,
                Err(error) => panic!("expected apply to succeed: {error:?}"),
            },
            None
        );

        let renamed = match match p.apply(&ProjectPatch { name: Some("새 이름".into()), ..Default::default() }) {
            Ok(value) => value,
            Err(error) => panic!("expected apply to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert_eq!(renamed.name, "새 이름");
        assert_eq!(renamed.version, 1);

        let archived = match match renamed.apply(&ProjectPatch { archived: Some(true), ..Default::default() }) {
            Ok(value) => value,
            Err(error) => panic!("expected apply to succeed: {error:?}"),
        } {
            Some(value) => value,
            None => panic!("expected returned value to be present"),
        };
        assert!(archived.archived);
        assert_eq!(archived.version, 2);

        assert!(p.apply(&ProjectPatch { name: Some(String::new()), ..Default::default() }).is_err());
    }
}
