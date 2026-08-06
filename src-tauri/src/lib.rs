mod atomic_write;

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
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(navigation_guard())
        .invoke_handler(tauri::generate_handler![
            atomic_write::atomic_write_text_file,
            confirm_app_exit
        ]);

    #[cfg(feature = "wdio")]
    {
        builder = builder
            .plugin(tauri_plugin_wdio::init())
            .plugin(tauri_plugin_wdio_webdriver::init());
    }

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tomark");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let exit_confirmed = APP_EXIT_CONFIRMED.swap(false, Ordering::SeqCst);
            let has_windows = !app_handle.webview_windows().is_empty();
            if should_prevent_app_exit(exit_confirmed, has_windows) {
                api.prevent_exit();
                let _ = app_handle.emit(APP_EXIT_REQUESTED_EVENT, ());
            }
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
