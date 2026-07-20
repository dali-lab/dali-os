// Window construction + helpers. The main (remote) window is built
// programmatically so we can attach `on_navigation` (the only place the shell
// watches webview navigation — for the /login re-pair trigger). The pairing
// window hosts the local, trusted sign-in UI.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::config::PROD_ORIGIN;

pub fn build_pairing(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("pairing") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "pairing", WebviewUrl::App("index.html".into()))
        .title("Sign in to DALI OS")
        .inner_size(420.0, 560.0)
        .resizable(false)
        .center()
        .visible(false)
        .build()
}

pub fn ensure_main(app: &AppHandle, initial_url: &str) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("main") {
        return Ok(w);
    }
    let url = Url::parse(initial_url).unwrap_or_else(|_| Url::parse(PROD_ORIGIN).unwrap());
    let nav_handle = app.clone();
    // The remote page has no IPC, so the shell hands its version over as a
    // frozen global re-injected on every top-frame navigation. Workspace-tab
    // iframes read it via window.top (same origin). The web app renders it on
    // Settings (app/lib/desktop.ts in dali-api).
    let version_script = format!(
        "window.__DALI_DESKTOP = Object.freeze({{ version: '{}' }});",
        app.package_info().version
    );
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("DALI OS")
        .inner_size(1280.0, 832.0)
        .min_inner_size(900.0, 600.0)
        .visible(false)
        .initialization_script(&version_script)
        .on_navigation(move |u| crate::nav::on_navigation(&nav_handle, u))
        .build()
}

pub fn show_main(app: &AppHandle) {
    if let Ok(w) = ensure_main(app, PROD_ORIGIN) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn navigate_main(app: &AppHandle, url: &str) {
    match app.get_webview_window("main") {
        Some(w) => {
            if let Ok(u) = Url::parse(url) {
                let _ = w.navigate(u);
            }
        }
        None => {
            let _ = ensure_main(app, url);
        }
    }
}

/// Focus the main window and navigate it to a link — absolute, or app-relative
/// against the prod origin. Shared by notification click-through and the tray
/// menu; same routing a `dalios://notify?link=` deep link gets.
pub fn open_link(app: &AppHandle, link: &str) {
    show_main(app);
    let full = if link.starts_with("http") {
        link.to_string()
    } else {
        format!("{PROD_ORIGIN}{link}")
    };
    navigate_main(app, &full);
}

pub fn show_pairing(app: &AppHandle) {
    if let Ok(w) = build_pairing(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn hide_pairing(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("pairing") {
        let _ = w.hide();
    }
}

pub fn set_badge(app: &AppHandle, count: i64) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_badge_count(if count > 0 { Some(count) } else { None });
    }
}

pub fn apply_zoom(app: &AppHandle, factor: f64) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_zoom(factor);
    }
}

/// Find-in-page (Edit → Find). The remote page has no IPC access, so the bar
/// is driven by eval: the script defines `window.__daliFindBar` once (its own
/// guard makes re-eval a no-op) and each menu action calls into it. `action`
/// is one of open/next/prev.
pub fn find_action(app: &AppHandle, action: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(&format!(
            "{}\nwindow.__daliFindBar.{}();",
            include_str!("find.js"),
            action
        ));
    }
}
