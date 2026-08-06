//! Request / guide setting tomark as the default Markdown handler.
//!
//! Windows and Linux cannot silently change defaults; they open the system UI.
//! macOS uses NSWorkspace and may still show a system confirmation.

use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppResult {
    pub ok: bool,
    pub message: String,
    pub opened_settings: bool,
}

#[cfg(target_os = "macos")]
fn app_bundle_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("无法定位应用路径：{err}"))?;
    let mut bundle = exe;
    for _ in 0..4 {
        if bundle
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
        {
            return Ok(bundle);
        }
        if !bundle.pop() {
            break;
        }
    }
    Err("开发态或不完整安装包无法设置默认应用，请使用安装后的 .app".into())
}

#[cfg(target_os = "macos")]
fn request_macos_default() -> DefaultAppResult {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;
    use std::sync::{Arc, Condvar, Mutex};

    let app_path = match app_bundle_path() {
        Ok(path) => path,
        Err(message) => {
            return DefaultAppResult {
                ok: false,
                message,
                opened_settings: false,
            };
        }
    };

    let path_str = app_path.to_string_lossy();
    let app_url = NSURL::fileURLWithPath(&NSString::from_str(path_str.as_ref()));

    let Some(content_type) =
        UTType::typeWithIdentifier(&NSString::from_str("net.daringfireball.markdown"))
    else {
        return DefaultAppResult {
            ok: false,
            message: "系统不支持 Markdown UTI".into(),
            opened_settings: false,
        };
    };

    let pair = Arc::new((Mutex::new(None::<Result<(), String>>), Condvar::new()));
    let pair_clone = Arc::clone(&pair);

    let completion = RcBlock::new(move |error: *mut NSError| {
        let mut slot = pair_clone.0.lock().unwrap();
        if error.is_null() {
            *slot = Some(Ok(()));
        } else {
            // SAFETY: completion handler provides a valid NSError pointer when non-null.
            let err: Retained<NSError> = unsafe { Retained::retain(error).unwrap() };
            *slot = Some(Err(err.localizedDescription().to_string()));
        }
        pair_clone.1.notify_one();
    });

    let workspace = NSWorkspace::sharedWorkspace();
    workspace.setDefaultApplicationAtURL_toOpenContentType_completionHandler(
        &app_url,
        &content_type,
        Some(&*completion),
    );

    let (lock, cvar) = &*pair;
    let mut guard = lock.lock().unwrap();
    while guard.is_none() {
        guard = cvar.wait(guard).unwrap();
    }

    match guard.take().unwrap() {
        Ok(()) => DefaultAppResult {
            ok: true,
            message: "已请求将 tomark 设为 Markdown 默认应用（系统可能仍需确认）".into(),
            opened_settings: false,
        },
        Err(message) => DefaultAppResult {
            ok: false,
            message,
            opened_settings: false,
        },
    }
}

#[cfg(windows)]
fn request_windows_default() -> DefaultAppResult {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    match Command::new("cmd")
        .args(["/C", "start", "", "ms-settings:defaultapps"])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
    {
        Ok(_) => DefaultAppResult {
            ok: true,
            message: "已打开 Windows 默认应用设置，请搜索 .md 并选择 tomark".into(),
            opened_settings: true,
        },
        Err(err) => DefaultAppResult {
            ok: false,
            message: format!("打开默认应用设置失败：{err}"),
            opened_settings: false,
        },
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn request_linux_default() -> DefaultAppResult {
    use std::process::Command;

    if Command::new("xdg-open")
        .arg("preferences://default-apps")
        .spawn()
        .is_ok()
    {
        return DefaultAppResult {
            ok: true,
            message: "已尝试打开系统默认应用设置，请将 Markdown 关联到 tomark".into(),
            opened_settings: true,
        };
    }

    DefaultAppResult {
        ok: false,
        message: "请在系统设置中将 .md 的默认应用设为 tomark".into(),
        opened_settings: false,
    }
}

#[tauri::command]
pub fn request_default_markdown_app<R: Runtime>(_app: AppHandle<R>) -> DefaultAppResult {
    #[cfg(target_os = "macos")]
    {
        let _ = _app;
        return request_macos_default();
    }
    #[cfg(windows)]
    {
        let _ = _app;
        return request_windows_default();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = _app;
        return request_linux_default();
    }
    #[allow(unreachable_code)]
    {
        let _ = _app;
        DefaultAppResult {
            ok: false,
            message: "当前平台不支持自动设置默认应用".into(),
            opened_settings: false,
        }
    }
}
