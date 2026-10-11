// Tray icon + panel. Left-click toggles the custom DALI OS panel window
// (window::toggle_tray_panel); right-click (and Linux, which reports no
// left-click events through AppIndicator) shows a minimal native menu built
// from the same tray_model::TrayView. refresh() re-derives that view from
// AppState after every delivery sync and pushes it to both surfaces.
// Combined with minimize-to-tray (see lib.rs window event), this keeps the
// background delivery loop alive and glanceable when the main window is
// closed.

use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::state::{self, AppState};
use crate::tray_model::{self, TitleMode, TraySnapshot, TrayView};
use crate::{notify, recording, window};

const TRAY_ID: &str = "main-tray";

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn snapshot(app: &AppHandle) -> TraySnapshot {
    let state = app.state::<AppState>();
    let notifs = state.recent_notifs.lock().map(|g| g.clone()).unwrap_or_default();
    let unread_count = state.unread_count.load(Ordering::SeqCst);

    let recording_live = state.recording.lock().map(|g| g.is_some()).unwrap_or(false);
    let recording = recording_live.then(|| recording::elapsed_secs()).flatten().map(|elapsed_secs| {
        let title = state.recording_title.lock().ok().and_then(|g| g.clone()).unwrap_or_default();
        tray_model::RecordingSnap { title, elapsed_secs }
    });

    let next = state.agenda.lock().ok().and_then(|g| g.clone());
    let title_mode = state.title_mode.lock().map(|g| *g).unwrap_or_default();
    let tasks = state.tasks.lock().map(|g| g.clone()).unwrap_or_default();
    let task_count = state.task_count.load(Ordering::SeqCst);

    let connection = match state.connection.load(Ordering::SeqCst) {
        state::CONNECTION_LIVE => tray_model::Connection::Live,
        state::CONNECTION_OFFLINE => tray_model::Connection::Offline,
        _ => tray_model::Connection::Polling,
    };
    let last_sync_secs = state.last_sync.lock().ok().and_then(|g| *g).map(|t| t.elapsed().as_secs());

    TraySnapshot {
        unread_count,
        notifs,
        recording,
        version: app.package_info().version.to_string(),
        next,
        now_unix: now_unix(),
        title_mode,
        tasks,
        task_count,
        connection,
        last_sync_secs,
    }
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    title_mode: Option<TitleMode>,
}

fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join("settings.json"))
}

/// Read once at startup (lib.rs's setup, before `install`). A missing or
/// corrupt file is just defaults — never a hard error.
pub fn load_title_mode(app: &AppHandle) -> TitleMode {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .and_then(|s| s.title_mode)
        .unwrap_or_default()
}

pub fn save_title_mode(app: &AppHandle, mode: TitleMode) {
    let Some(path) = settings_path(app) else {
        return;
    };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&Settings { title_mode: Some(mode) }) {
        let _ = std::fs::write(path, json);
    }
}

fn build_menu(app: &AppHandle, view: &TrayView) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    let recording = view.recording.is_some();

    if cfg!(target_os = "linux") {
        // The only surface on Linux: AppIndicator never reports tray clicks,
        // so the recent rows have to live here instead of the panel.
        menu.append(&MenuItem::with_id(app, "open", "Open DALI OS", true, None::<&str>)?)?;
        if !view.unread.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            for row in &view.unread {
                let prefix = if row.urgent { "⏰ " } else { "" };
                menu.append(&MenuItem::with_id(
                    app,
                    format!("recent:{}", row.id),
                    format!("{prefix}{}", row.title),
                    true,
                    None::<&str>,
                )?)?;
            }
        }
        if recording {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            menu.append(&MenuItem::with_id(app, "stop-recording", "● Stop recording", true, None::<&str>)?)?;
        }
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "quit", "Quit DALI OS", true, None::<&str>)?)?;
    } else {
        if recording {
            menu.append(&MenuItem::with_id(app, "stop-recording", "● Stop recording", true, None::<&str>)?)?;
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        menu.append(&MenuItem::with_id(app, "open", "Open DALI OS", true, None::<&str>)?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&MenuItem::with_id(app, "quit", "Quit DALI OS", true, None::<&str>)?)?;
    }
    Ok(menu)
}

/// Open the link (or the main window, if it has none) for a "recent:<id>"
/// menu click, resolving the id against the last-built view, then marks the
/// notification read — same as a panel row click (commands::tray_open_link).
fn open_recent(app: &AppHandle, id: &str) {
    let link = app
        .state::<AppState>()
        .tray_view
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .and_then(|v| v.unread.into_iter().find(|r| r.id == id))
        .and_then(|r| r.link);
    match link {
        Some(link) => window::open_link(app, &link),
        None => window::show_main(app),
    }
    notify::mark_read(app, id);
}

/// Re-derive the tray/panel view from AppState and push it to both
/// surfaces: the icon's title/tooltip (always), the panel window (via
/// `tray://state`, only if the view actually changed), and the native menu
/// (only if its content changed — recording start/stop, or on Linux the
/// unread rows, since that's everything the menu shows).
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };

    let view = tray_model::build(&snapshot(app));
    let previous = app.state::<AppState>().tray_view.lock().map(|g| g.clone()).unwrap_or_default();

    let _ = tray.set_title(tray_model::title(&view));
    let _ = tray.set_tooltip(Some(tray_model::tooltip(&view)));

    // Windows has no tray title text and no per-app taskbar badge API, so
    // the unread count is baked into the icon's pixels instead (tray_badge.rs).
    #[cfg(target_os = "windows")]
    {
        static BASE_ICON: std::sync::OnceLock<Option<tauri::image::Image<'static>>> =
            std::sync::OnceLock::new();
        let base = BASE_ICON.get_or_init(|| app.default_window_icon().cloned());
        if let Some(base) = base {
            let icon = crate::tray_badge::with_count(base, view.unread_count);
            let _ = tray.set_icon(Some(icon));
        }
    }

    let menu_changed = match &previous {
        None => true,
        Some(prev) => {
            prev.recording.is_some() != view.recording.is_some()
                || (cfg!(target_os = "linux") && prev.unread != view.unread)
        }
    };
    if menu_changed {
        if let Ok(menu) = build_menu(app, &view) {
            let _ = tray.set_menu(Some(menu));
        }
    }

    if previous.as_ref() != Some(&view) {
        if let Ok(mut guard) = app.state::<AppState>().tray_view.lock() {
            *guard = Some(view.clone());
        }
        let _ = app.emit_to("tray", "tray://state", view);
    }
}

/// Recording started or stopped — nothing else changed, but routing through
/// `refresh` keeps the icon/menu/panel all derived from one place.
pub fn rebuild_menu(app: &AppHandle) {
    refresh(app);
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let view = tray_model::build(&snapshot(app));
    let menu = build_menu(app, &view)?;
    if let Ok(mut guard) = app.state::<AppState>().tray_view.lock() {
        *guard = Some(view);
    }

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DALI OS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(notif_id) = id.strip_prefix("recent:") {
                open_recent(app, notif_id);
                return;
            }
            match id {
                "open" => window::show_main(app),
                "stop-recording" => recording::stop(),
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                window::toggle_tray_panel(tray.app_handle(), &rect);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
