// Tray icon + menu. Left-click toggles the main window; the menu lists the
// latest unread notifications (urgent first, click-through to their links)
// above Open, Sign out, and Quit. refresh() re-renders the unread count next
// to the menubar icon and rebuilds the menu after every delivery sync.
// Combined with minimize-to-tray (see lib.rs window event), this keeps the
// background delivery loop alive and glanceable when the window is closed.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::{commands, state::AppState, window};

const TRAY_ID: &str = "main-tray";
// Keeps long notification titles from blowing out the menu width.
const TITLE_MAX_CHARS: usize = 44;

fn truncated(s: &str) -> String {
    if s.chars().count() <= TITLE_MAX_CHARS {
        return s.to_string();
    }
    let cut: String = s.chars().take(TITLE_MAX_CHARS - 1).collect();
    format!("{cut}…")
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let recent = app
        .state::<AppState>()
        .recent_notifs
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default();

    let menu = Menu::new(app)?;
    for (i, n) in recent.iter().enumerate() {
        let prefix = if n.urgent { "⏰ " } else { "" };
        let label = format!("{prefix}{}", truncated(&n.title));
        menu.append(&MenuItem::with_id(
            app,
            format!("recent:{i}"),
            label,
            true,
            None::<&str>,
        )?)?;
    }
    if !recent.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", "Open DALI OS", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "signout", "Sign out", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit DALI OS", true, None::<&str>)?)?;
    Ok(menu)
}

/// Re-render the tray for the current unread state: the count beside the
/// menubar icon (macOS/Linux; title is a no-op elsewhere) and the
/// recent-notifications section of the menu.
pub fn refresh(app: &AppHandle, unread: i64) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let _ = tray.set_title(if unread > 0 { Some(unread.to_string()) } else { None });
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DALI OS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(idx) = id.strip_prefix("recent:").and_then(|s| s.parse::<usize>().ok()) {
                let link = app
                    .state::<AppState>()
                    .recent_notifs
                    .lock()
                    .ok()
                    .and_then(|g| g.get(idx).and_then(|n| n.link.clone()));
                match link {
                    Some(link) => window::open_link(app, &link),
                    None => window::show_main(app),
                }
                return;
            }
            match id {
                "open" => window::show_main(app),
                "signout" => {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        commands::do_sign_out(handle).await;
                    });
                }
                "quit" => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                window::show_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}
