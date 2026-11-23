use process_flow_adapter_system::StorageLocks;

#[test]
fn second_writer_is_rejected_and_lock_releases_on_drop() {
    let root = tempfile::tempdir().unwrap();
    let sqlite = root.path().join("data/state.sqlite3");
    let lance = root.path().join("data/search.lancedb");
    let first = StorageLocks::acquire(Some(&sqlite), &lance).unwrap();
    assert!(StorageLocks::acquire(Some(&sqlite), &lance).is_err());
    drop(first);
    assert!(StorageLocks::acquire(Some(&sqlite), &lance).is_ok());
}

#[test]
fn sharing_either_database_requires_exclusive_ownership() {
    let root = tempfile::tempdir().unwrap();
    let sqlite = root.path().join("state.sqlite3");
    let lance = root.path().join("search.lancedb");
    let _first = StorageLocks::acquire(Some(&sqlite), &lance).unwrap();
    assert!(StorageLocks::acquire(Some(&sqlite), &root.path().join("other.lancedb")).is_err());
    assert!(StorageLocks::acquire(Some(&root.path().join("other.sqlite3")), &lance).is_err());
}

#[cfg(unix)]
#[test]
fn symlinked_database_paths_share_the_same_lock() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("actual");
    std::fs::create_dir(&directory).unwrap();
    std::os::unix::fs::symlink(&directory, root.path().join("alias")).unwrap();
    let _first =
        StorageLocks::acquire(Some(&directory.join("state.sqlite3")), &directory.join("search.lancedb")).unwrap();
    assert!(
        StorageLocks::acquire(Some(&root.path().join("alias/state.sqlite3")), &root.path().join("other.lancedb"))
            .is_err()
    );
}
