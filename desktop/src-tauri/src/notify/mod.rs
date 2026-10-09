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
//
// Record-prompt banners (macOS only — see poller.rs for how `recordPrompt`
// items are raised/deferred) add a `record` action: POST
// /api/meeting-recordings, then hand the id straight to recording::start.
// Their payload (link + scheduledMeetingId + occurrenceStart) is too much to
// round-trip through notification userInfo cleanly, so it's stashed here in a
// small in-memory map keyed by notification id instead, written at raise
// time and consumed when the action fires.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::{config, keychain, recording, state::AppState, window};

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
// Record-prompt actions (macOS only — see notify/macos.rs's dedicated
// category; Windows/Linux get a plain banner and fall back to click-opens).
pub const ACTION_RECORD: &str = "record";
pub const ACTION_OPEN: &str = "open";

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
    // Record-prompt (poller.rs) → Record/Open buttons on macOS. The payload
    // the Record action needs is stashed separately (see `stash_record_prompt`
    // below), not carried on the banner itself.
    pub record: bool,
}

impl Banner {
    fn is_row(&self) -> bool {
        !self.id.is_empty()
    }
}

/// Everything the Record action needs once it fires, stashed at raise time
/// and consumed (removed) when the user acts on the banner.
#[derive(Clone)]
pub struct RecordPromptPayload {
    pub link: Option<String>,
    pub scheduled_meeting_id: String,
    pub occurrence_start: String,
}

// `Mutex<Option<_>>` rather than a const-initialized HashMap, matching the
// `EVENTS`/`AUDIO` statics in recording.rs (`HashMap::new()` isn't `const`).
static RECORD_PROMPTS: Mutex<Option<HashMap<String, RecordPromptPayload>>> = Mutex::new(None);

/// Stash a record-prompt's payload under its notification id, just before
/// raising the banner (poller.rs, both the immediate and deferred paths).
pub fn stash_record_prompt(id: &str, payload: RecordPromptPayload) {
    if let Ok(mut guard) = RECORD_PROMPTS.lock() {
        guard.get_or_insert_with(HashMap::new).insert(id.to_string(), payload);
    }
}

pub(crate) fn take_record_prompt(id: &str) -> Option<RecordPromptPayload> {
    RECORD_PROMPTS
        .lock()
        .ok()
        .and_then(|mut guard| guard.as_mut().and_then(|m| m.remove(id)))
}

/// Drop any stashed record-prompt payloads — called on sign-out so a new
/// account on the same machine starts clean.
pub fn clear_record_prompts() {
    if let Ok(mut guard) = RECORD_PROMPTS.lock() {
        *guard = None;
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
            record: false,
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

/// Banner action button: `read`, `rsvp:<accepted|tentative|declined>`,
/// `record` or `open` (record-prompt banners, macOS only). Anything else
/// (e.g. the macOS dismiss identifier) is a no-op.
pub(crate) fn on_action(app: &AppHandle, id: &str, action: &str) {
    if id.is_empty() {
        return;
    }
    if action == ACTION_READ {
        post(app, format!("{}/api/notifications/{id}/read", config::PROD_ORIGIN), None);
    } else if action == ACTION_OPEN {
        let link = take_record_prompt(id).and_then(|p| p.link);
        on_clicked(app, id, link.as_deref());
    } else if action == ACTION_RECORD {
        let Some(payload) = take_record_prompt(id) else { return };
        start_recording_from_prompt(app, id.to_string(), payload);
    } else if let Some(response) = action.strip_prefix(RSVP_PREFIX) {
        post(
            app,
            format!("{}/api/notifications/{id}/rsvp", config::PROD_ORIGIN),
            Some(serde_json::json!({ "response": response })),
        );
    }
}

#[derive(serde::Deserialize)]
struct CreatedRecording {
    id: String,
}

#[derive(serde::Deserialize, Default)]
struct RecordingErrorBody {
    #[serde(default)]
    error: String,
}

/// "Record" tapped on a record-prompt banner: create the MeetingRecording
/// and start capturing immediately, no deep link and no page open. On any
/// refusal (noteRequired / forbidden / recordingDisabled / 503) or network
/// failure, fall back to opening the item's link — the web page explains why
/// and offers browser recording instead.
fn start_recording_from_prompt(app: &AppHandle, id: String, payload: RecordPromptPayload) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(token) = keychain::get_token() else {
            return on_clicked(&app, &id, payload.link.as_deref());
        };
        let http = app.state::<AppState>().http.clone();
        let resp = http
            .post(config::meeting_recordings_url())
            .bearer_auth(&token)
            .json(&serde_json::json!({
                "scheduledMeetingId": payload.scheduled_meeting_id,
                "occurrenceStart": payload.occurrence_start,
            }))
            .send()
            .await;

        let resp = match resp {
            Ok(r) => r,
            Err(_) => return on_clicked(&app, &id, payload.link.as_deref()),
        };

        if resp.status() == reqwest::StatusCode::CREATED {
            if let Ok(created) = resp.json::<CreatedRecording>().await {
                recording::start(&app, created.id);
                post(&app, format!("{}/api/notifications/{id}/read", config::PROD_ORIGIN), None);
                return;
            }
            return on_clicked(&app, &id, payload.link.as_deref());
        }

        let error = resp.json::<RecordingErrorBody>().await.unwrap_or_default().error;
        on_clicked(&app, &id, payload.link.as_deref());
        if error == "recordingDisabled" {
            raise_simple(&app, "DALI OS", "Recording is turned off for this project.");
        }
    });
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
