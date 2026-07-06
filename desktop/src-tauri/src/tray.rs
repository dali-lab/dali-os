// Tray icon + menu. Left-click toggles the main window; the menu offers Open,
// Sign out, and Quit. Combined with minimize-to-tray (see lib.rs window event),
// this keeps the background notification poller alive when the window is closed.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

use crate::{commands, window};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open DALI OS", true, None::<&str>)?;
    let signout = MenuItem::with_id(app, "signout", "Sign out", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DALI OS", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open, &signout, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("DALI OS")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => window::show_main(app),
            "signout" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    commands::do_sign_out(handle).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
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
