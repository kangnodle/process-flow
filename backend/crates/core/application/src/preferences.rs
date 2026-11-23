use process_flow_domain::TaskId;

macro_rules! string_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($variant),+ }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }

            pub fn parse(value: &str) -> Option<Self> {
                match value { $($text => Some(Self::$variant),)+ _ => None }
            }
        }
    };
}

string_enum!(
    Locale { Ko => "ko", En => "en" }
);
string_enum!(
    Theme { System => "system", Light => "light", Dark => "dark" }
);
string_enum!(
    View { Stage => "stage", Task => "task", Board => "board" }
);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkspacePreferences {
    pub locale: Option<Locale>,
    pub theme: Option<Theme>,
    pub view: Option<View>,
    pub selected_task_id: Option<TaskId>,
}

impl WorkspacePreferences {
    #[must_use]
    pub fn merged(self, patch: &Self) -> Self {
        Self {
            locale: patch.locale.or(self.locale),
            theme: patch.theme.or(self.theme),
            view: patch.view.or(self.view),
            selected_task_id: patch.selected_task_id.clone().or(self.selected_task_id),
        }
    }

    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }
}
