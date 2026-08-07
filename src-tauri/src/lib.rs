mod atomic_write;
mod default_app;
mod document_io;
mod export_io;
mod open_file;
mod text_codec;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager, Runtime, Url};

const APP_EXIT_REQUESTED_EVENT: &str = "tomark-app-exit-requested";
static APP_EXIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

fn is_app_entry_url(url: &Url, is_dev: bool) -> bool {
    if !matches!(url.path(), "" | "/" | "/index.html") {
        return false;
    }

    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "http" if is_dev => {
            matches!(url.host_str(), Some("localhost" | "127.0.0.1")) && url.port() == Some(1420)
        }
        _ => false,
    }
}

fn navigation_guard<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| is_app_entry_url(url, cfg!(debug_assertions)))
        .build()
}

fn should_prevent_app_exit(exit_confirmed: bool, has_windows: bool) -> bool {
    has_windows && !exit_confirmed
}

#[tauri::command]
fn confirm_app_exit(app: tauri::AppHandle) {
    APP_EXIT_CONFIRMED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // Single-instance must be registered first on Windows/Linux so subsequent
    // "Open with" launches forward argv into the running process.
    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = open_file::collect_markdown_paths_from_args(argv.into_iter().skip(1));
            open_file::deliver_open_paths(&app, files);
        }));
    }

    builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(navigation_guard())
        .manage(open_file::PendingOpenFiles::default())
        .invoke_handler(tauri::generate_handler![
            atomic_write::atomic_write_text_file,
            document_io::load_markdown_document,
            document_io::save_markdown_document,
            export_io::atomic_write_bytes_file,
            export_io::read_export_image,
            export_io::write_html_export_bundle,
            confirm_app_exit,
            open_file::acknowledge_open_file_listener,
            default_app::request_default_markdown_app
        ]);

    #[cfg(feature = "wdio")]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    {
        builder = builder.setup(|app| {
            let files = open_file::collect_markdown_paths_from_args(std::env::args().skip(1));
            open_file::deliver_open_paths(app.handle(), files);
            Ok(())
        });
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tomark");

    app.run(|app_handle, event| {
        match &event {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let files = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect::<Vec<_>>();
                open_file::deliver_open_paths(app_handle, files);
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                let exit_confirmed = APP_EXIT_CONFIRMED.swap(false, Ordering::SeqCst);
                let has_windows = !app_handle.webview_windows().is_empty();
                if should_prevent_app_exit(exit_confirmed, has_windows) {
                    api.prevent_exit();
                    let _ = app_handle.emit(APP_EXIT_REQUESTED_EVENT, ());
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_only_allows_the_app_entry() {
        assert!(is_app_entry_url(
            &Url::parse("tauri://localhost").unwrap(),
            false
        ));
        assert!(is_app_entry_url(
            &Url::parse("tauri://localhost/").unwrap(),
            false
        ));
        assert!(is_app_entry_url(
            &Url::parse("https://tauri.localhost/index.html#note").unwrap(),
            false
        ));
        assert!(!is_app_entry_url(
            &Url::parse("https://example.com/").unwrap(),
            false
        ));
        assert!(!is_app_entry_url(
            &Url::parse("tauri://localhost/other.md").unwrap(),
            false
        ));
    }

    #[test]
    fn navigation_allows_the_configured_dev_server_only_in_dev() {
        let url = Url::parse("http://localhost:1420/").unwrap();
        assert!(is_app_entry_url(&url, true));
        assert!(!is_app_entry_url(&url, false));
        assert!(!is_app_entry_url(
            &Url::parse("http://localhost:9999/").unwrap(),
            true
        ));
    }

    #[test]
    fn exit_is_guarded_only_while_a_window_can_confirm() {
        assert!(should_prevent_app_exit(false, true));
        assert!(!should_prevent_app_exit(true, true));
        assert!(!should_prevent_app_exit(false, false));
    }
}
