use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_fs::FsExt;

pub const OPEN_FILE_EVENT: &str = "tomark-open-file";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenFilePayload {
    pub path: String,
}

#[derive(Default)]
pub struct PendingOpenFiles {
    ready: Mutex<bool>,
    paths: Mutex<Vec<String>>,
}

impl PendingOpenFiles {
    pub fn mark_ready(&self) {
        if let Ok(mut ready) = self.ready.lock() {
            *ready = true;
        }
    }

    pub fn is_ready(&self) -> bool {
        self.ready.lock().map(|v| *v).unwrap_or(false)
    }

    pub fn push(&self, path: String) {
        if let Ok(mut paths) = self.paths.lock() {
            if !paths.iter().any(|existing| existing == &path) {
                paths.push(path);
            }
        }
    }

    pub fn take_all(&self) -> Vec<String> {
        self.paths
            .lock()
            .map(|mut paths| std::mem::take(&mut *paths))
            .unwrap_or_default()
    }
}

pub fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            lower == "md" || lower == "markdown"
        })
        .unwrap_or(false)
}

pub fn parse_path_arg(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return None;
    }

    if let Ok(url) = url::Url::parse(trimmed) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
        // Skip non-file URLs (deep links, etc.).
        if url.scheme() != "file" && trimmed.contains("://") {
            return None;
        }
    }

    Some(PathBuf::from(trimmed))
}

pub fn collect_markdown_paths(raw_paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for path in raw_paths {
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if !canonical.is_file() || !is_markdown_path(&canonical) {
            continue;
        }
        if seen.insert(canonical.clone()) {
            out.push(canonical);
        }
    }

    out
}

#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn collect_markdown_paths_from_args(args: impl IntoIterator<Item = String>) -> Vec<PathBuf> {
    let paths = args
        .into_iter()
        .filter_map(|arg| parse_path_arg(&arg))
        .collect::<Vec<_>>();
    collect_markdown_paths(paths)
}

fn allow_fs_path<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    let _ = app.fs_scope().allow_file(path);
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Deliver the first markdown path to the frontend (queue if listener not ready).
pub fn deliver_open_paths<R: Runtime>(app: &AppHandle<R>, files: Vec<PathBuf>) {
    let markdown = collect_markdown_paths(files);
    let Some(first) = markdown.into_iter().next() else {
        return;
    };

    allow_fs_path(app, &first);
    let path = first.to_string_lossy().to_string();
    focus_main_window(app);

    let pending = app.state::<PendingOpenFiles>();
    if pending.is_ready() {
        let _ = app.emit(OPEN_FILE_EVENT, OpenFilePayload { path });
    } else {
        pending.push(path);
    }
}

#[tauri::command]
pub fn acknowledge_open_file_listener(
    app: AppHandle,
    pending: State<'_, PendingOpenFiles>,
) -> Vec<String> {
    pending.mark_ready();
    let queued = pending.take_all();
    for path in &queued {
        let path_buf = PathBuf::from(path);
        allow_fs_path(&app, &path_buf);
    }
    focus_main_window(&app);
    queued
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tomark-open-file-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn accepts_markdown_extensions_only() {
        assert!(is_markdown_path(Path::new("/tmp/a.md")));
        assert!(is_markdown_path(Path::new("/tmp/a.MD")));
        assert!(is_markdown_path(Path::new("/tmp/a.markdown")));
        assert!(!is_markdown_path(Path::new("/tmp/a.txt")));
        assert!(!is_markdown_path(Path::new("/tmp/a")));
    }

    #[test]
    fn parses_file_urls_and_skips_flags() {
        assert!(parse_path_arg("-f").is_none());
        assert!(parse_path_arg("--flag").is_none());
        assert_eq!(
            parse_path_arg("/tmp/note.md"),
            Some(PathBuf::from("/tmp/note.md"))
        );

        let url = url::Url::from_file_path("/tmp/note.md").unwrap();
        assert_eq!(parse_path_arg(url.as_str()), Some(PathBuf::from("/tmp/note.md")));
        assert!(parse_path_arg("https://example.com/a.md").is_none());
    }

    #[test]
    fn collects_existing_markdown_files_and_dedupes() {
        let dir = temp_dir();
        let md = dir.join("note.md");
        let other = dir.join("note.txt");
        fs::write(&md, "# hi").unwrap();
        fs::write(&other, "x").unwrap();

        let paths = collect_markdown_paths(vec![
            md.clone(),
            other,
            md.clone(),
            dir.join("missing.md"),
        ]);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0], md.canonicalize().unwrap());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn pending_queue_is_ready_gated() {
        let pending = PendingOpenFiles::default();
        assert!(!pending.is_ready());
        pending.push("/tmp/a.md".into());
        pending.push("/tmp/a.md".into());
        assert_eq!(pending.take_all(), vec!["/tmp/a.md".to_string()]);
        pending.mark_ready();
        assert!(pending.is_ready());
    }
}
