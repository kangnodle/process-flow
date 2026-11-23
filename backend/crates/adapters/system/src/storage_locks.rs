use std::fs::{File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub struct StorageLocks {
    _files: Vec<File>,
}

impl StorageLocks {
    pub fn acquire(sqlite_path: Option<&Path>, lance_path: &Path) -> io::Result<Self> {
        std::fs::create_dir_all(lance_path)?;
        let mut paths = vec![lock_path(&lance_path.canonicalize()?)?];
        if let Some(path) = sqlite_path {
            let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
            std::fs::create_dir_all(parent)?;
            let canonical =
                if path.exists() {
                    path.canonicalize()?
                } else {
                    parent.canonicalize()?.join(path.file_name().ok_or_else(|| {
                        io::Error::new(io::ErrorKind::InvalidInput, "SQLite path requires a file name")
                    })?)
                };
            paths.push(lock_path(&canonical)?);
        }
        paths.sort();
        paths.dedup();
        let mut files = Vec::with_capacity(paths.len());
        for path in paths {
            let file = OpenOptions::new().create(true).truncate(false).read(true).write(true).open(&path)?;
            file.try_lock().map_err(|error| {
                io::Error::other(format!("storage is already in use ({}): {error}", path.display()))
            })?;
            files.push(file);
        }
        Ok(Self { _files: files })
    }
}

fn lock_path(path: &Path) -> io::Result<PathBuf> {
    let mut name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "storage path requires a name"))?
        .to_os_string();
    name.push(".process-flow.lock");
    Ok(path.with_file_name(name))
}
