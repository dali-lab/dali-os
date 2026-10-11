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

use crate::state::AppState;
use crate::tray_model::{self, TraySnapshot, TrayView};
use crate::{notify, recording, window};

const TRAY_ID: &str = "main-tray";

fn snapshot(app: &AppHandle) -> TraySnapshot {
    let state = app.state::<AppState>();
    let notifs = state.recent_notifs.lock().map(|g| g.clone()).unwrap_or_default();
    let unread_count = state.unread_count.load(Ordering::SeqCst);
    // `recording` only ever holds the MeetingRecording id (recording.rs),
    // never a title, so "recording" collapses to an empty, unknown title.
    let recording = state.recording.lock().ok().and_then(|g| g.as_ref().map(|_| String::new()));
    TraySnapshot { unread_count, notifs, recording, version: app.package_info().version.to_string() }
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
