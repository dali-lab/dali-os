// Native macOS menu bar (NSApplication.mainMenu). Standard roles use
// PredefinedMenuItem so macOS wires up labels, shortcuts, and behavior (e.g.
// Cut/Copy/Paste work in the WKWebView via the responder chain — no handler
// needed). App-specific items use MenuItem::with_id and are dispatched by the
// Builder::on_menu_event handler in lib.rs. Custom ids are kept distinct from the
// tray ids (open/signout/quit in tray.rs).

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    // App-handled items (see lib.rs on_menu_event).
    let check_update = MenuItem::with_id(app, "check-update", "Check for Updates…", true, None::<&str>)?;
    let sign_out = MenuItem::with_id(app, "sign-out", "Sign Out", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    let help_item = MenuItem::with_id(app, "help", "DALI OS Help", true, None::<&str>)?;

    let app_menu = Submenu::with_items(
        app,
        "DALI OS",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &check_update,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &sign_out,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &reload,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let help_menu = Submenu::with_items(app, "Help", true, &[&help_item])?;

    Menu::with_items(
        app,
        &[&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )
}
