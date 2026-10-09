// Window construction + helpers. The main (remote) window is built
// programmatically so we can attach `on_navigation` (the only place the shell
// watches webview navigation — for the /login re-pair trigger). The pairing
// window hosts the local, trusted sign-in UI.

use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::config::{self, PROD_ORIGIN};
use crate::state::AppState;

// Floating record-prompt window (see notify/mod.rs for the payload it's fed
// and poller.rs for when it's raised). Sized and positioned to match a small
// "toast" in the mockup's bottom-right corner, never the native title bar.
const RECORD_PROMPT_WIDTH: f64 = 420.0;
const RECORD_PROMPT_HEIGHT: f64 = 132.0;
const RECORD_PROMPT_MARGIN: f64 = 24.0;

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
    let load_handle = app.clone();
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
        // When the remote page finishes loading, reveal the window and stand
        // down the offline watchdog. (Only the top frame reports here.)
        .on_page_load(move |_webview, payload| {
            if let PageLoadEvent::Finished = payload.event() {
                crate::nav::on_page_finished(&load_handle, payload.url());
            }
        })
        .build()
}

pub fn show_main(app: &AppHandle) {
    if let Ok(w) = ensure_main(app, PROD_ORIGIN) {
        app.state::<AppState>().mark_revealed();
        hide_splash(app);
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Cold-start entry for a returning (paired) user. Builds the main window (which
/// begins loading the remote origin), shows a branded splash for feedback, then
/// either reveals the app or — if the origin can't be reached — swaps to the
/// bundled offline page, so the user never faces a blank webview.
pub fn start_main(app: &AppHandle) {
    let _ = ensure_main(app, PROD_ORIGIN);
    show_splash(app);
    let gen = app.state::<AppState>().arm_load();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Unreachable right now (no network, server down) → offline page instead
        // of a blank window. Skip if the page raced us and already loaded.
        if !reachable(&handle).await {
            if !handle.state::<AppState>().loaded_since(gen) {
                show_offline(&handle);
            }
            return;
        }
        // Reachable: the page load itself reveals the window (on_page_finished).
        // This fallback covers a missed load-finished signal (e.g. an occluded
        // webview deferring its load) — reveal anyway so the app can't stay
        // hidden behind the splash on a working connection.
        tokio::time::sleep(Duration::from_secs(config::BOOT_REVEAL_MAX_SECS)).await;
        reveal_main(&handle);
    });
}

/// Show the main window exactly once (idempotent). Called on first successful
/// load, the cold-start reveal fallback, and by `show_offline`.
pub fn reveal_main(app: &AppHandle) {
    if app.state::<AppState>().mark_revealed() {
        return; // already revealed
    }
    hide_splash(app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Swap the main window to the bundled offline page and reveal it — a failed
/// remote load lands on a retry card instead of a blank webview. The card's
/// Retry link navigates back to the prod origin (allowed by `nav::on_navigation`,
/// which also re-arms the offline watchdog).
pub fn show_offline(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(u) = Url::parse(&config::offline_url()) {
            let _ = w.navigate(u);
        }
        app.state::<AppState>().mark_revealed();
        hide_splash(app);
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Arm a watchdog that swaps to the offline page after a grace period **iff**
/// the origin is unreachable. The reachability probe is what makes this safe to
/// call on every post-launch navigation: a slow-but-working load is never
/// bumped offline, only a genuinely unreachable one.
pub fn arm_offline_watchdog(app: &AppHandle) {
    let gen = app.state::<AppState>().arm_load();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(config::OFFLINE_WATCH_SECS)).await;
        if handle.state::<AppState>().loaded_since(gen) {
            return; // a page finished loading since we armed — all good
        }
        if !reachable(&handle).await {
            show_offline(&handle);
        }
    });
}

/// True if the prod origin returns *any* HTTP response within the probe timeout.
/// A non-2xx (a 500, say) still counts as reachable — the offline page is only
/// for "can't reach the server at all", which is what the blank webview meant.
async fn reachable(app: &AppHandle) -> bool {
    let http = app.state::<AppState>().http.clone();
    http.get(PROD_ORIGIN)
        .timeout(Duration::from_secs(config::OFFLINE_PROBE_TIMEOUT_SECS))
        .send()
        .await
        .is_ok()
}

fn build_splash(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("splash") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("loading.html".into()))
        .title("DALI OS")
        .inner_size(420.0, 320.0)
        .resizable(false)
        .decorations(false)
        .center()
        .visible(false)
        .build()
}

pub fn show_splash(app: &AppHandle) {
    if app.state::<AppState>().is_revealed() {
        return; // main already up — no splash needed
    }
    if let Ok(w) = build_splash(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn hide_splash(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("splash") {
        let _ = w.close();
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

fn build_record_prompt(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("record-prompt") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "record-prompt", WebviewUrl::App("record-prompt.html".into()))
        .inner_size(RECORD_PROMPT_WIDTH, RECORD_PROMPT_HEIGHT)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        // Raised in the background by the poller/frontmost watcher — never
        // steal focus from whatever (e.g. the meeting app) is frontmost.
        .focused(false)
        .shadow(true)
        .visible(false)
        .build()
}

/// Bottom-right of the primary display, inset by `RECORD_PROMPT_MARGIN` and
/// clear of the Dock/menu bar (`work_area`, not the full display bounds).
/// Falls back to the display's own bounds if the OS can't report a work
/// area, and does nothing (keeps whatever position it last had) if there's
/// no primary monitor at all.
fn position_record_prompt(app: &AppHandle, window: &WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let x = (area.position.x as f64 / scale) + (area.size.width as f64 / scale)
        - RECORD_PROMPT_WIDTH
        - RECORD_PROMPT_MARGIN;
    let y = (area.position.y as f64 / scale) + (area.size.height as f64 / scale)
        - RECORD_PROMPT_HEIGHT
        - RECORD_PROMPT_MARGIN;
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
}

/// Show the floating "Meeting detected" window with `view`'s content
/// (the JSON shape `record-prompt.js` expects — see notify::raise_record_prompt).
/// Reuses the one `record-prompt` window for the life of the session: calling
/// this again while it's already showing a different prompt just replaces its
/// content, which is the only "one at a time" rule this needs.
pub fn show_record_prompt(app: &AppHandle, view: serde_json::Value) {
    let Ok(w) = build_record_prompt(app) else {
        return;
    };
    position_record_prompt(app, &w);
    let _ = app.emit_to("record-prompt", "record-prompt://show", view);
    let _ = w.show();
}

pub fn hide_record_prompt(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("record-prompt") {
        let _ = w.hide();
    }
    if let Ok(mut current) = app.state::<AppState>().current_record_prompt.lock() {
        *current = None;
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
        let _ = w.eval(format!(
            "{}\nwindow.__daliFindBar.{}();",
            include_str!("find.js"),
            action
        ));
    }
}
