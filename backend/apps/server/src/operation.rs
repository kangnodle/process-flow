#[derive(Debug, PartialEq, Eq)]
pub enum Operation {
    Serve,
    RebuildSearch,
}

impl Operation {
    pub fn parse(args: impl IntoIterator<Item = String>) -> Result<Self, String> {
        let args: Vec<_> = args.into_iter().collect();
        match args.as_slice() {
            [] => Ok(Self::Serve),
            [command] if command == "--rebuild-search" => Ok(Self::RebuildSearch),
            _ => Err("usage: process-flow-server [--rebuild-search]".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Operation;

    #[test]
    fn routes_server_and_rebuild_commands() {
        assert_eq!(Operation::parse(Vec::<String>::new()).unwrap(), Operation::Serve);
        assert_eq!(Operation::parse(["--rebuild-search".to_owned()]).unwrap(), Operation::RebuildSearch);
    }

    #[test]
    fn rejects_snapshot_import_when_starting_with_fresh_data() {
        assert!(Operation::parse(["--import-snapshot".to_owned(), "data/export.json".to_owned()]).is_err());
    }

    #[test]
    fn rejects_unknown_or_incomplete_commands() {
        assert!(Operation::parse(["--unknown".to_owned()]).is_err());
        assert!(Operation::parse(["--import-snapshot".to_owned()]).is_err());
        assert!(Operation::parse(["--rebuild-search".to_owned(), "extra".to_owned()]).is_err());
    }
}
