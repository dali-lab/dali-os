// Native banners + banner actions, raised by the background delivery loop
// (called directly from Rust — works with the main window's IPC fully locked)
// and rendered by per-platform backends:
//
//   macOS    UNUserNotificationCenter (bundled builds): clicks survive app
//            relaunch, RSVP/Mark-read buttons, Notification Center cleanup
//            when rows are read elsewhere. Unbundled dev (`tauri dev`) falls
//            back to mac-notification-sys — banner + body click only.
//   Linux    notify-rust over the XDG D-Bus spec: default click + action
//            buttons where the notification daemon supports them.
//   Windows  WinRT toasts via tauri-winrt-notification: click + buttons
//            while the process runs (tray-resident, so effectively always).
//
// Backends only render banners and report responses; the meaning is shared
// here: a body click navigates to the notification's link and best-effort
// marks it read (parity with the web bell — the server skips self-clearing
// kinds itself); `rsvp:*` actions POST /api/notifications/:id/rsvp; `read`
// POSTs :id/read. The server publishes every write to the notification
// stream, so badge/tray converge through the normal delivery loop.

use tauri::{AppHandle, Manager};

use crate::{config, keychain, state::AppState, window};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

// Action identifiers shared by every backend. The `rsvp:` suffixes are the
// API's response enum verbatim (see api.notifications.$id.rsvp.ts).
pub const ACTION_READ: &str = "read";
pub const RSVP_PREFIX: &str = "rsvp:";
pub const ACTION_RSVP_ACCEPT: &str = "rsvp:accepted";
pub const ACTION_RSVP_MAYBE: &str = "rsvp:tentative";
pub const ACTION_RSVP_DECLINE: &str = "rsvp:declined";

#[derive(Clone)]
pub struct Banner {
    // Notification row id; empty for shell-local banners (update status,
    // sign-in expired), which get no action buttons and no read tracking.
    pub id: String,
    pub title: String,
    pub body: String,
    pub link: Option<String>,
    pub urgent: bool,
    // Meeting invite awaiting an RSVP → Accept/Maybe/Decline buttons.
    pub rsvp: bool,
}

impl Banner {
    fn is_row(&self) -> bool {
        !self.id.is_empty()
    }
}

/// One-time platform setup. On macOS this installs the notification delegate,
/// registers action categories, and requests authorization; elsewhere a no-op.
pub fn init(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::init(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

pub fn raise(app: &AppHandle, mut banner: Banner) {
    if banner.title.is_empty() {
        banner.title = "DALI OS".to_string();
    }
    #[cfg(target_os = "macos")]
    macos::raise(app, banner);
    #[cfg(target_os = "linux")]
    linux::raise(app, banner);
    #[cfg(target_os = "windows")]
    windows::raise(app, banner);
}

/// Shell-local banner with no notification row behind it.
pub fn raise_simple(app: &AppHandle, title: &str, body: &str) {
    raise(
        app,
        Banner {
            id: String::new(),
            title: title.to_string(),
            body: body.to_string(),
            link: None,
            urgent: false,
            rsvp: false,
        },
    );
}

/// Remove delivered banners for rows read elsewhere (macOS Notification
/// Center only; the other platforms have no comparable history API wired up).
pub fn clear_delivered(ids: &[String]) {
    #[cfg(target_os = "macos")]
    macos::clear_delivered(ids);
    #[cfg(not(target_os = "macos"))]
    let _ = ids;
}

pub fn clear_all_delivered() {
    #[cfg(target_os = "macos")]
    macos::clear_all_delivered();
}

// ─── Shared response handling (called from platform callback threads) ───────

/// Banner body clicked: focus + navigate, best-effort mark read.
pub(crate) fn on_clicked(app: &AppHandle, id: &str, link: Option<&str>) {
    let nav_app = app.clone();
    let link = link.map(str::to_string);
    // Backend callbacks can arrive on arbitrary threads; window work must run
    // on the main thread.
    let _ = app.run_on_main_thread(move || match link.as_deref() {
        Some(link) => window::open_link(&nav_app, link),
        None => window::show_main(&nav_app),
    });
    if !id.is_empty() {
        post(app, format!("{}/api/notifications/{id}/read", config::PROD_ORIGIN), None);
    }
}

/// Banner action button: `read` or `rsvp:<accepted|tentative|declined>`.
/// Anything else (e.g. the macOS dismiss identifier) is a no-op.
pub(crate) fn on_action(app: &AppHandle, id: &str, action: &str) {
    if id.is_empty() {
        return;
    }
    if action == ACTION_READ {
        post(app, format!("{}/api/notifications/{id}/read", config::PROD_ORIGIN), None);
    } else if let Some(response) = action.strip_prefix(RSVP_PREFIX) {
        post(
            app,
            format!("{}/api/notifications/{id}/rsvp", config::PROD_ORIGIN),
            Some(serde_json::json!({ "response": response })),
        );
    }
}

// Fire-and-forget authenticated POST. The server publishes the write to the
// notification stream, so badge/tray/Notification Center converge through the
// delivery loop rather than ad-hoc local state edits.
fn post(app: &AppHandle, url: String, json: Option<serde_json::Value>) {
    let http = app.state::<AppState>().http.clone();
    tauri::async_runtime::spawn(async move {
        let Some(token) = keychain::get_token() else {
            return;
        };
        let mut req = http.post(url).bearer_auth(token);
        if let Some(body) = json {
            req = req.json(&body);
        }
        let _ = req.send().await;
    });
}
