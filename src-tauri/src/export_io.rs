use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use atomic_write_file::AtomicWriteFile;
use base64::Engine;
use tauri::{AppHandle, Runtime};
use tauri_plugin_fs::FsExt;

use crate::atomic_write::{
    resolve_write_target, write_bytes, write_bytes_resolved, AtomicWriteError,
};

const MAX_IMAGE_BYTES_DEFAULT: usize = 8 * 1024 * 1024;
const MAX_EXPORT_FILE_BYTES: usize = 256 * 1024 * 1024;
const MAX_HTML_CONTENT_BYTES: usize = 32 * 1024 * 1024;
const MAX_HTML_ASSET_COUNT: usize = 512;
const MAX_HTML_ASSET_TOTAL_BYTES: usize = 128 * 1024 * 1024;

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
    /// Standard base64 keeps multi-MB images compact over JSON IPC.
    pub contents_base64: String,
    pub mime_type: String,
    pub extension: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HtmlExportAsset {
    pub relative_path: String,
    /// Standard base64 (JSON-safe). Avoids multi‑MB `Vec<u8>` over JSON IPC.
    pub contents_base64: String,
}

fn decode_base64_bytes(input: &str) -> Result<Vec<u8>, ExportIoError> {
    base64::engine::general_purpose::STANDARD
        .decode(input.trim())
        .map_err(|error| ExportIoError::Message(format!("无效的二进制数据：{error}")))
}

fn decode_base64_bytes_limited(input: &str, max_bytes: usize) -> Result<Vec<u8>, ExportIoError> {
    let trimmed = input.trim();
    let max_encoded_len = max_bytes.saturating_add(2) / 3 * 4;
    if trimmed.len() > max_encoded_len.saturating_add(4) {
        return Err(ExportIoError::Message("二进制数据超过大小限制".into()));
    }
    let bytes = decode_base64_bytes(trimmed)?;
    if bytes.len() > max_bytes {
        return Err(ExportIoError::Message("二进制数据超过大小限制".into()));
    }
    Ok(bytes)
}

fn ensure_allowed<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<(), ExportIoError> {
    if app.fs_scope().is_allowed(path) {
        return Ok(());
    }
    // Save-dialog selections are granted by the dialog plugin. Dev force-export
    // skips the dialog, so allow concrete temp-dir targets in debug builds only.
    #[cfg(debug_assertions)]
    {
        let temp = std::env::temp_dir();
        if path.starts_with(&temp) {
            let _ = app.fs_scope().allow_file(path);
            if app.fs_scope().is_allowed(path) {
                return Ok(());
            }
        }
    }
    Err(ExportIoError::PathForbidden)
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

fn image_byte_limit(requested: Option<usize>) -> usize {
    requested
        .unwrap_or(MAX_IMAGE_BYTES_DEFAULT)
        .min(MAX_IMAGE_BYTES_DEFAULT)
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
                    return Err(ExportIoError::Message("图片路径越出文档目录".into()));
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
        || trimmed.starts_with('.')
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('\0')
        || mime_for_extension(&extension_of(Path::new(trimmed))).is_none()
    {
        return Err(ExportIoError::Message("资源文件名不合法".into()));
    }
    Ok(trimmed.to_string())
}

fn assets_dir_name_valid(name: &str) -> bool {
    let trimmed = name.trim();
    !trimmed.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && trimmed != "."
        && trimmed != ".."
        && !name.contains('\0')
        && trimmed.ends_with("_files")
}

fn expected_assets_dir_name(html_path: &Path) -> Result<String, ExportIoError> {
    let stem = html_path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ExportIoError::Message("HTML 路径缺少有效文件名".into()))?;
    Ok(format!("{stem}_files"))
}

fn prepare_assets_directory(parent: &Path, name: &str) -> Result<PathBuf, ExportIoError> {
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| ExportIoError::Message("HTML 导出目录无效".into()))?;
    let candidate = canonical_parent.join(name);

    match fs::symlink_metadata(&candidate) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(ExportIoError::Message("资源目录不能是符号链接".into()));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(ExportIoError::Message("资源目录路径已被文件占用".into()));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&candidate)?;
        }
        Err(error) => return Err(error.into()),
    }

    let canonical = candidate.canonicalize()?;
    if canonical.parent() != Some(canonical_parent.as_path()) {
        return Err(ExportIoError::Message("资源目录越出导出目录".into()));
    }
    Ok(canonical)
}

#[tauri::command]
pub fn atomic_write_bytes_file<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    contents_base64: String,
) -> Result<(), ExportIoError> {
    let target = resolve_write_target(Path::new(&path))?;
    ensure_allowed(&app, &target)?;
    let contents = decode_base64_bytes_limited(&contents_base64, MAX_EXPORT_FILE_BYTES)?;
    write_bytes_resolved(&target, &contents)?;
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
    // The command is callable from the WebView; callers may lower but never
    // raise the native ceiling.
    let limit = image_byte_limit(max_bytes);
    if metadata.len() > limit as u64 {
        return Err(ExportIoError::Message("图片超过大小限制".into()));
    }

    let bytes = fs::read(&canonical)?;
    if bytes.len() > limit {
        return Err(ExportIoError::Message("图片超过大小限制".into()));
    }
    Ok(ExportImagePayload {
        contents_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
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
    let requested_html_path = Path::new(&html_path);
    if expected_assets_dir_name(requested_html_path)? != assets_dir_name {
        return Err(ExportIoError::Message(
            "资源目录名必须与 HTML 文件名一致".into(),
        ));
    }
    if html_content.len() > MAX_HTML_CONTENT_BYTES {
        return Err(ExportIoError::Message("HTML 内容超过大小限制".into()));
    }
    if assets.len() > MAX_HTML_ASSET_COUNT {
        return Err(ExportIoError::Message("HTML 资源文件数量超过限制".into()));
    }

    let html_target = resolve_write_target(requested_html_path)?;
    ensure_allowed(&app, &html_target)?;

    let mut decoded_assets = Vec::with_capacity(assets.len());
    let mut total_asset_bytes = 0usize;
    for asset in assets {
        let name = sanitize_asset_name(&asset.relative_path)?;
        let remaining = MAX_HTML_ASSET_TOTAL_BYTES
            .checked_sub(total_asset_bytes)
            .ok_or_else(|| ExportIoError::Message("HTML 资源总大小超过限制".into()))?;
        let bytes = decode_base64_bytes_limited(
            &asset.contents_base64,
            remaining.min(MAX_IMAGE_BYTES_DEFAULT),
        )?;
        total_asset_bytes = total_asset_bytes
            .checked_add(bytes.len())
            .ok_or_else(|| ExportIoError::Message("HTML 资源总大小超过限制".into()))?;
        decoded_assets.push((name, bytes));
    }

    let parent = html_target
        .parent()
        .ok_or_else(|| ExportIoError::Message("HTML 路径无效".into()))?;
    let assets_dir = prepare_assets_directory(parent, &assets_dir_name)?;

    // Write assets first so a mid-flight failure does not leave a finished-looking
    // HTML file that points at a missing sibling directory.
    for (name, bytes) in decoded_assets {
        let target = assets_dir.join(name);
        if fs::symlink_metadata(&target)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err(ExportIoError::Message("资源文件不能是符号链接".into()));
        }
        let mut file = AtomicWriteFile::options().open(&target)?;
        file.write_all(&bytes)?;
        file.as_file().sync_all()?;
        file.commit()?;
    }

    write_bytes_resolved(&html_target, html_content.as_bytes())?;
    Ok(())
}

/// Dev force-export: frontend polls this to pick up a job written by scripts/.
#[tauri::command]
pub fn poll_force_export_job() -> Result<Option<String>, ExportIoError> {
    #[cfg(not(debug_assertions))]
    {
        return Ok(None);
    }
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join("tomark-force-export-job.json");
        if !path.is_file() {
            return Ok(None);
        }
        let contents = fs::read_to_string(&path)?;
        let _ = fs::remove_file(&path);
        Ok(Some(contents))
    }
}

/// Dev force-export: frontend writes the JSON result for the waiting script.
#[tauri::command]
pub fn write_force_export_result(payload: String) -> Result<(), ExportIoError> {
    #[cfg(not(debug_assertions))]
    {
        let _ = payload;
        return Err(ExportIoError::Message(
            "force-export result is only available in debug builds".into(),
        ));
    }
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join("tomark-force-export-result.json");
        write_bytes(&path, payload.as_bytes())?;
        Ok(())
    }
}

/// Dev force-export: progress breadcrumbs for the waiting script.
#[tauri::command]
pub fn write_force_export_status(message: String) -> Result<(), ExportIoError> {
    #[cfg(not(debug_assertions))]
    {
        let _ = message;
        return Ok(());
    }
    #[cfg(debug_assertions)]
    {
        let path = std::env::temp_dir().join("tomark-force-export-status.txt");
        write_bytes(&path, message.as_bytes())?;
        Ok(())
    }
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
        assert!(assets_dir_name_valid("note..draft_files"));
        assert!(!assets_dir_name_valid("../x"));
        assert!(!assets_dir_name_valid("a/b"));
        assert!(!assets_dir_name_valid(".ssh"));
        assert!(!assets_dir_name_valid("note-assets"));
        assert!(!assets_dir_name_valid(".."));
        assert!(!assets_dir_name_valid(""));
        assert_eq!(
            expected_assets_dir_name(Path::new("/tmp/note.html")).unwrap(),
            "note_files"
        );
    }

    #[test]
    fn rejects_unsupported_image_extension() {
        assert!(mime_for_extension("exe").is_none());
        assert_eq!(mime_for_extension("png"), Some("image/png"));
        assert_eq!(mime_for_extension("jpeg"), Some("image/jpeg"));
    }

    #[test]
    fn clamps_caller_supplied_image_limit() {
        assert_eq!(image_byte_limit(None), MAX_IMAGE_BYTES_DEFAULT);
        assert_eq!(image_byte_limit(Some(1024)), 1024);
        assert_eq!(
            image_byte_limit(Some(MAX_IMAGE_BYTES_DEFAULT * 2)),
            MAX_IMAGE_BYTES_DEFAULT
        );
    }

    #[test]
    fn rejects_base64_payloads_over_native_limit() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(b"hello");
        assert_eq!(decode_base64_bytes_limited(&encoded, 5).unwrap(), b"hello");
        assert!(decode_base64_bytes_limited(&encoded, 4).is_err());
    }

    #[test]
    fn sanitizes_asset_names() {
        assert!(sanitize_asset_name("ok.png").is_ok());
        assert!(sanitize_asset_name("draft..final.png").is_ok());
        assert!(sanitize_asset_name("authorized_keys").is_err());
        assert!(sanitize_asset_name(".hidden.png").is_err());
        assert!(sanitize_asset_name("../x.png").is_err());
        assert!(sanitize_asset_name("a/b.png").is_err());
        assert!(sanitize_asset_name("..").is_err());
        assert!(sanitize_asset_name("").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_assets_directory() {
        use std::os::unix::fs::symlink;

        let root =
            std::env::temp_dir().join(format!("tomark-export-assets-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let output = root.join("output");
        let outside = root.join("outside");
        fs::create_dir_all(&output).unwrap();
        fs::create_dir_all(&outside).unwrap();
        symlink(&outside, output.join("note_files")).unwrap();

        let error = prepare_assets_directory(&output, "note_files").unwrap_err();
        assert!(error.to_string().contains("符号链接"));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn resolve_write_target_follows_symlink() {
        use std::os::unix::fs::symlink;

        let dir =
            std::env::temp_dir().join(format!("tomark-export-symlink-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.bin");
        let link = dir.join("note.bin");
        fs::write(&target, b"old").unwrap();
        symlink("target.bin", &link).unwrap();

        let resolved = resolve_write_target(&link).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&dir);
    }
}
