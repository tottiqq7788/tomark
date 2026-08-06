use std::io::Write;
use std::path::Path;

use atomic_write_file::AtomicWriteFile;
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

#[derive(Debug, thiserror::Error)]
pub enum AtomicWriteError {
    #[error("path is not allowed by the filesystem scope")]
    PathForbidden,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for AtomicWriteError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

fn resolve_write_target(path: &Path) -> Result<std::path::PathBuf, AtomicWriteError> {
    Ok(match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => path.canonicalize()?,
        Ok(_) => path.to_path_buf(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => path.to_path_buf(),
        Err(error) => return Err(error.into()),
    })
}

pub fn write_bytes(path: &Path, contents: &[u8]) -> Result<(), AtomicWriteError> {
    let target = resolve_write_target(path)?;
    let mut file = AtomicWriteFile::options().open(target)?;
    file.write_all(contents)?;
    file.as_file().sync_all()?;
    file.commit()?;
    Ok(())
}

#[tauri::command]
pub fn atomic_write_text_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: String,
) -> Result<(), AtomicWriteError> {
    let target = resolve_write_target(Path::new(&path))?;
    if !app.fs_scope().is_allowed(&target) {
        return Err(AtomicWriteError::PathForbidden);
    }
    write_bytes(&target, contents.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn commit_replaces_existing_file() {
        let dir = std::env::temp_dir().join(format!("tomark-atomic-write-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        fs::write(&path, b"old").unwrap();

        write_bytes(&path, b"new content").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discard_before_commit_keeps_original() {
        let dir =
            std::env::temp_dir().join(format!("tomark-atomic-discard-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("note.md");
        fs::write(&path, b"keep-me").unwrap();

        {
            let mut file = AtomicWriteFile::options().open(&path).unwrap();
            file.write_all(b"should-not-appear").unwrap();
            // Drop without commit: original remains.
        }

        assert_eq!(fs::read_to_string(&path).unwrap(), "keep-me");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn commit_through_symlink_preserves_link_and_updates_target() {
        use std::os::unix::fs::symlink;

        let dir =
            std::env::temp_dir().join(format!("tomark-atomic-symlink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.md");
        let link = dir.join("note.md");
        fs::write(&target, b"old").unwrap();
        symlink("target.md", &link).unwrap();

        write_bytes(&link, b"new content").unwrap();

        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "new content");
        let _ = fs::remove_dir_all(&dir);
    }
}
