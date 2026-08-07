use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use atomic_write_file::AtomicWriteFile;
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

use crate::atomic_write::{write_bytes, AtomicWriteError};

const MAX_IMAGE_BYTES_DEFAULT: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ExportIoError {
    #[error("path is not allowed by the filesystem scope")]
    PathForbidden,
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for ExportIoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

impl From<AtomicWriteError> for ExportIoError {
    fn from(value: AtomicWriteError) -> Self {
        match value {
            AtomicWriteError::PathForbidden => ExportIoError::PathForbidden,
            AtomicWriteError::Io(error) => ExportIoError::Io(error),
        }
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportImagePayload {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub extension: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlExportAsset {
    pub relative_path: String,
    pub contents: Vec<u8>,
}

fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), ExportIoError> {
    if app.fs_scope().is_allowed(path) {
        Ok(())
    } else {
        Err(ExportIoError::PathForbidden)
    }
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn mime_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn normalize_relative_image_path(relative_path: &str) -> Result<PathBuf, ExportIoError> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err(ExportIoError::Message("图片路径为空".into()));
    }
    if trimmed.starts_with('/')
        || trimmed.starts_with('\\')
        || trimmed.contains(':')
        || trimmed.starts_with("file:")
    {
        return Err(ExportIoError::Message("不支持绝对路径图片".into()));
    }

    let path = PathBuf::from(trimmed);
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(part) => normalized.push(part),
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(ExportIoError::Message(
                        "图片路径越出文档目录".into(),
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(ExportIoError::Message("不支持绝对路径图片".into()));
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        return Err(ExportIoError::Message("图片路径无效".into()));
    }
    Ok(normalized)
}

fn document_dir(document_path: &str) -> Result<PathBuf, ExportIoError> {
    let path = PathBuf::from(document_path);
    path.parent()
        .map(Path::to_path_buf)
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| ExportIoError::Message("文档路径无效".into()))
}

fn sanitize_asset_name(name: &str) -> Result<String, ExportIoError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
    {
        return Err(ExportIoError::Message("资源文件名不合法".into()));
    }
    Ok(trimmed.to_string())
}

fn assets_dir_name_valid(name: &str) -> bool {
    !name.trim().is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

#[tauri::command]
pub fn atomic_write_bytes_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents: Vec<u8>,
) -> Result<(), ExportIoError> {
    let target = PathBuf::from(&path);
    ensure_allowed(&app, &target)?;
    write_bytes(&target, &contents)?;
    Ok(())
}

#[tauri::command]
pub fn read_export_image<R: Runtime>(
    app: AppHandle<R>,
    document_path: String,
    relative_path: String,
    max_bytes: Option<usize>,
) -> Result<ExportImagePayload, ExportIoError> {
    let doc_path = PathBuf::from(&document_path);
    ensure_allowed(&app, &doc_path)?;

    let relative = normalize_relative_image_path(&relative_path)?;
    let extension = extension_of(&relative);
    let mime = mime_for_extension(&extension)
        .ok_or_else(|| ExportIoError::Message(format!("不支持的图片类型：.{extension}")))?;

    let base = document_dir(&document_path)?;
    let candidate = base.join(&relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| ExportIoError::Message("找不到本地图片".into()))?;
    let base_canonical = base
        .canonicalize()
        .map_err(|_| ExportIoError::Message("文档目录无效".into()))?;
    if !canonical.starts_with(&base_canonical) {
        return Err(ExportIoError::Message("图片路径越出文档目录".into()));
    }

    let metadata = fs::metadata(&canonical)?;
    if !metadata.is_file() {
        return Err(ExportIoError::Message("图片路径不是文件".into()));
    }
    let limit = max_bytes.unwrap_or(MAX_IMAGE_BYTES_DEFAULT);
    if metadata.len() as usize > limit {
        return Err(ExportIoError::Message("图片超过大小限制".into()));
    }

    let bytes = fs::read(&canonical)?;
    Ok(ExportImagePayload {
        bytes,
        mime_type: mime.to_string(),
        extension,
    })
}

#[tauri::command]
pub fn write_html_export_bundle<R: Runtime>(
    app: AppHandle<R>,
    html_path: String,
    html_content: String,
    assets_dir_name: String,
    assets: Vec<HtmlExportAsset>,
) -> Result<(), ExportIoError> {
    if !assets_dir_name_valid(&assets_dir_name) {
        return Err(ExportIoError::Message("资源目录名不合法".into()));
    }

    let html_target = PathBuf::from(&html_path);
    ensure_allowed(&app, &html_target)?;
    write_bytes(&html_target, html_content.as_bytes())?;

    let parent = html_target
        .parent()
        .ok_or_else(|| ExportIoError::Message("HTML 路径无效".into()))?;
    let assets_dir = parent.join(&assets_dir_name);
    fs::create_dir_all(&assets_dir)?;

    // Allow subsequent asset writes under the newly created directory.
    let _ = app.fs_scope().allow_directory(&assets_dir, true);

    for asset in assets {
        let name = sanitize_asset_name(&asset.relative_path)?;
        let target = assets_dir.join(name);
        let mut file = AtomicWriteFile::options().open(&target)?;
        file.write_all(&asset.contents)?;
        file.as_file().sync_all()?;
        file.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_escape() {
        assert!(normalize_relative_image_path("../secret.png").is_err());
        assert!(normalize_relative_image_path("/tmp/a.png").is_err());
        assert!(normalize_relative_image_path("C:\\\\a.png").is_err());
        assert!(normalize_relative_image_path("file:/tmp/a.png").is_err());
    }

    #[test]
    fn accepts_nested_relative_image() {
        let path = normalize_relative_image_path("./images/../images/a.png").unwrap();
        assert_eq!(path, PathBuf::from("images/a.png"));
    }

    #[test]
    fn validates_assets_dir_name() {
        assert!(assets_dir_name_valid("note_files"));
        assert!(!assets_dir_name_valid("../x"));
        assert!(!assets_dir_name_valid("a/b"));
        assert!(!assets_dir_name_valid(""));
    }

    #[test]
    fn rejects_unsupported_image_extension() {
        assert!(mime_for_extension("exe").is_none());
        assert_eq!(mime_for_extension("png"), Some("image/png"));
        assert_eq!(mime_for_extension("jpeg"), Some("image/jpeg"));
    }

    #[test]
    fn sanitizes_asset_names() {
        assert!(sanitize_asset_name("ok.png").is_ok());
        assert!(sanitize_asset_name("../x.png").is_err());
        assert!(sanitize_asset_name("a/b.png").is_err());
        assert!(sanitize_asset_name("").is_err());
    }
}
