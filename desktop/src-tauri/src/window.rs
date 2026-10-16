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
// and poller.rs for when it's raised): a single-row pill at the top centre of
// the primary display. The window is transparent (macOSPrivateApi) so only the
// pill itself paints; the page draws its own shadow inside the frame. The
// chevron menu can't overflow the frame, so the window grows to
// `RECORD_PROMPT_EXPANDED_HEIGHT` while it's open (`set_record_prompt_expanded`).
const RECORD_PROMPT_WIDTH: f64 = 560.0;
const RECORD_PROMPT_HEIGHT: f64 = 76.0;
const RECORD_PROMPT_EXPANDED_HEIGHT: f64 = 212.0;
const RECORD_PROMPT_TOP_MARGIN: f64 = 12.0;

// Tray panel window (see tray.rs for when it's toggled): anchored under the
// tray icon on macOS/Linux, above it on Windows (taskbar's at the bottom).
// tray.js grows/shrinks the frame to fit its content via
// `set_tray_panel_height`, between these bounds.
const TRAY_PANEL_WIDTH: f64 = 304.0;
const TRAY_PANEL_HEIGHT: f64 = 320.0;
const TRAY_PANEL_MIN_HEIGHT: f64 = 120.0;
const TRAY_PANEL_MAX_HEIGHT: f64 = 640.0;
const TRAY_PANEL_GAP: f64 = 6.0;
const TRAY_PANEL_REOPEN_GUARD: std::time::Duration = std::time::Duration::from_millis(300);

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
        .transparent(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        // Raised in the background by the poller/frontmost watcher — never
        // steal focus from whatever (e.g. the meeting app) is frontmost.
        .focused(false)
        // The native shadow would outline the rectangular frame, not the
        // pill; record-prompt.css draws one that hugs the rounded edge.
        .shadow(false)
        .visible(false)
        .build()
}

/// Top centre of the primary display, `RECORD_PROMPT_TOP_MARGIN` below the
/// menu bar (`work_area`, not the full display bounds). Does nothing (keeps
/// whatever position it last had) if there's no primary monitor at all.
fn position_record_prompt(app: &AppHandle, window: &WebviewWindow) {
    let Ok(Some(monitor)) = app.primary_monitor() else {
        return;
    };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let x = (area.position.x as f64 / scale)
        + ((area.size.width as f64 / scale) - RECORD_PROMPT_WIDTH) / 2.0;
    let y = (area.position.y as f64 / scale) + RECORD_PROMPT_TOP_MARGIN;
    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
}

/// Grow the frame while the pill's chevron menu is open (it hangs below the
/// pill, inside the window), shrink it back when the menu closes. The window
/// is anchored at its top-left, so only the bottom edge moves.
pub fn set_record_prompt_expanded(app: &AppHandle, expanded: bool) {
    if let Some(w) = app.get_webview_window("record-prompt") {
        let height = if expanded { RECORD_PROMPT_EXPANDED_HEIGHT } else { RECORD_PROMPT_HEIGHT };
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(RECORD_PROMPT_WIDTH, height)));
    }
}

/// Show the floating record-prompt pill with `view`'s content
/// (the JSON shape `record-prompt.js` expects — see notify::raise_record_prompt).
/// Reuses the one `record-prompt` window for the life of the session: calling
/// this again while it's already showing a different prompt just replaces its
/// content, which is the only "one at a time" rule this needs.
pub fn show_record_prompt(app: &AppHandle, view: serde_json::Value) {
    let Ok(w) = build_record_prompt(app) else {
        return;
    };
    set_record_prompt_expanded(app, false);
    position_record_prompt(app, &w);
    if let Ok(mut stored) = app.state::<AppState>().record_prompt_view.lock() {
        *stored = Some(view.clone());
    }
    let _ = app.emit_to("record-prompt", "record-prompt://show", view);
    let _ = w.show();
}

pub fn hide_record_prompt(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("record-prompt") {
        let _ = w.hide();
    }
    set_record_prompt_expanded(app, false);
    if let Ok(mut current) = app.state::<AppState>().current_record_prompt.lock() {
        *current = None;
    }
    if let Ok(mut stored) = app.state::<AppState>().record_prompt_view.lock() {
        *stored = None;
    }
}

fn build_tray_panel(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window("tray") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("tray.html".into()))
        .inner_size(TRAY_PANEL_WIDTH, TRAY_PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .build()
}

/// Anchors the panel to the tray icon's rect (from the click event), on the
/// monitor that rect is actually on, clamped into that monitor's work area.
/// `rect`'s position/size come back physical; everything here converts to
/// logical, matching `set_position`/`set_size` below.
fn position_tray_panel(app: &AppHandle, window: &WebviewWindow, rect: &tauri::Rect, height: Option<f64>) {
    let point = rect.position.to_physical::<f64>(1.0);
    let monitor = app
        .monitor_from_point(point.x, point.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return;
    };

    let scale = monitor.scale_factor();
    let rect_pos = rect.position.to_logical::<f64>(scale);
    let rect_size = rect.size.to_logical::<f64>(scale);
    let panel_size = window
        .inner_size()
        .map(|s| (s.width as f64 / scale, s.height as f64 / scale))
        .unwrap_or((TRAY_PANEL_WIDTH, TRAY_PANEL_HEIGHT));
    // A set_size that just happened is not yet reflected by inner_size.
    let panel_size = (panel_size.0, height.unwrap_or(panel_size.1));

    let center_x = rect_pos.x + rect_size.width / 2.0;
    let x = center_x - panel_size.0 / 2.0;
    let y = if cfg!(target_os = "windows") {
        rect_pos.y - panel_size.1 - TRAY_PANEL_GAP
    } else {
        rect_pos.y + rect_size.height + TRAY_PANEL_GAP
    };

    let area = monitor.work_area();
    let area_x = area.position.x as f64 / scale;
    let area_y = area.position.y as f64 / scale;
    let area_w = area.size.width as f64 / scale;
    let area_h = area.size.height as f64 / scale;
    let x = x.clamp(area_x, (area_x + area_w - panel_size.0).max(area_x));
    let y = y.clamp(area_y, (area_y + area_h - panel_size.1).max(area_y));

    let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
}

/// Toggle the tray panel: hide it if it's already showing, otherwise
/// position it from the tray click's rect, hand it the current view (so a
/// freshly built page has something to render immediately), and show it.
pub fn toggle_tray_panel(app: &AppHandle, rect: &tauri::Rect) {
    if let Some(w) = app.get_webview_window("tray") {
        if w.is_visible().unwrap_or(false) {
            hide_tray_panel(app);
            return;
        }
    }
    // The mouse-down of this same click already blurred (and hid) the panel
    // on platforms where the tray takes focus; the mouse-up must not reopen it.
    let just_hidden = app
        .state::<AppState>()
        .tray_hidden_at
        .lock()
        .ok()
        .and_then(|g| *g)
        .is_some_and(|t| t.elapsed() < TRAY_PANEL_REOPEN_GUARD);
    if just_hidden {
        return;
    }
    let Ok(w) = build_tray_panel(app) else {
        return;
    };
    if let Ok(mut g) = app.state::<AppState>().tray_anchor.lock() {
        *g = Some(*rect);
    }
    position_tray_panel(app, &w, rect, None);
    if let Ok(view) = app.state::<AppState>().tray_view.lock() {
        if let Some(view) = view.clone() {
            let _ = app.emit_to("tray", "tray://state", view);
        }
    }
    let _ = w.show();
    let _ = w.set_focus();
}

pub fn hide_tray_panel(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
            if let Ok(mut g) = app.state::<AppState>().tray_hidden_at.lock() {
                *g = Some(std::time::Instant::now());
            }
        }
    }
}

/// Content-driven resize from tray.js, then re-anchor to the icon so the
/// bottom edge stays put on Windows (the panel hangs above the taskbar).
pub fn set_tray_panel_height(app: &AppHandle, height: f64) {
    if let Some(w) = app.get_webview_window("tray") {
        let height = height.clamp(TRAY_PANEL_MIN_HEIGHT, TRAY_PANEL_MAX_HEIGHT);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(TRAY_PANEL_WIDTH, height)));
        let anchor = app.state::<AppState>().tray_anchor.lock().ok().and_then(|g| *g);
        if let Some(rect) = anchor {
            position_tray_panel(app, &w, &rect, Some(height));
        }
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

/// Asks the page to report its canonical URL back via `dalios://copy` (deeplink.rs).
pub fn copy_page_link(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(
            "window.dispatchEvent(new CustomEvent('dali:copy-page-link', { detail: { native: true } }));",
        );
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
