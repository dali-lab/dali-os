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
// Record prompts (see poller.rs for how `recordPrompt` items are
// raised/deferred) no longer go through the banner path above — they raise
// the floating record-prompt pill instead (`raise_record_prompt`,
// called from poller.rs). The macOS `dali-record-prompt` category and its
// Record/Open actions below (notify/macos.rs, ACTION_RECORD/ACTION_OPEN) are
// kept only so a banner already delivered by an older build (sitting in
// Notification Center, or still pending across an app restart) keeps working
// when clicked — no new banner is ever raised with `record: true` now.
//
// Either path needs more than fits in notification userInfo (link +
// scheduledMeetingId + occurrenceStart, plus the window's title/source/
// notePageId), so it's stashed here in a small in-memory map keyed by
// notification id instead, written at raise time and consumed when the user
// acts on it.

use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::json;
use tauri::{AppHandle, Manager};

use crate::{config, keychain, poller, recording, state::AppState, window};

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
// Legacy record-prompt banner actions (macOS only — notify/macos.rs's
// `dali-record-prompt` category). No longer attached to a newly-raised
// banner (see the module doc above); kept so one delivered before this
// build still has working buttons.
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
    // Legacy record-prompt banner (macOS) → Record/Open buttons. Nothing
    // raised by this build ever sets this true (see the module doc above);
    // it's only still read for a banner an older build delivered.
    pub record: bool,
}

impl Banner {
    fn is_row(&self) -> bool {
        !self.id.is_empty()
    }
}

/// Everything a record prompt needs once it's acted on — the floating
/// window's commands (`record_prompt_*` below) and, for an older build's
/// still-delivered banner, the legacy Record/Open actions. Stashed at raise
/// time, consumed (removed) when the user acts.
#[derive(Clone)]
pub struct RecordPromptPayload {
    // Meeting title, already resolved server-side onto the notification's
    // title (see jobs/meeting-record-prompts.server.ts) — shown as-is; the
    // window has no separate access to the raw meeting name.
    pub title: String,
    // "Zoom"/"Teams" when this raised because that app was frontmost
    // (poller.rs's record_prompt_watcher); `None` for an immediate raise (no
    // video link) or one that only hit the 2-minute fallback.
    pub source: Option<String>,
    pub note_page_id: Option<String>,
    pub link: Option<String>,
    pub scheduled_meeting_id: String,
    pub occurrence_start: String,
}

// `Mutex<Option<_>>` rather than a const-initialized HashMap, matching the
// `EVENTS`/`AUDIO` statics in recording.rs (`HashMap::new()` isn't `const`).
static RECORD_PROMPTS: Mutex<Option<HashMap<String, RecordPromptPayload>>> = Mutex::new(None);

/// Stash a record-prompt's payload under its notification id, just before
/// showing the floating window for it (`raise_record_prompt`, below).
fn stash_record_prompt(id: &str, payload: RecordPromptPayload) {
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

// ─── The floating record-prompt pill ────────────────────────────────────────
//
// Raised by poller.rs (immediate path in `sync_once`, deferred path in
// `check_pending_record_prompts`) instead of the Banner/macOS-category path
// above. Its commands (invoked from record-prompt.js, registered in
// commands.rs) call back into `record_prompt_start`/`_open`/`_dismiss`/`_mute`
// below, all keyed by notification id the same way the legacy banner actions
// were.

/// Raise the window for a newly-due record prompt. A no-op if the user
/// already closed this exact notification this session (defensive — nothing
/// in the delivery loop should re-offer an id once it's been shown).
pub fn raise_record_prompt(app: &AppHandle, id: &str, payload: RecordPromptPayload) {
    if let Ok(dismissed) = app.state::<AppState>().dismissed_record_prompts.lock() {
        if dismissed.contains(id) {
            return;
        }
    }
    let occurrence_start_unix = poller::parse_iso8601_unix(&payload.occurrence_start).unwrap_or(i64::MAX);
    let view = json!({
        "id": id,
        "title": payload.title,
        "source": payload.source,
        "notePageId": payload.note_page_id,
        "scheduledMeetingId": payload.scheduled_meeting_id,
        "occurrenceStart": payload.occurrence_start,
        "link": payload.link,
    });
    stash_record_prompt(id, payload);
    if let Ok(mut current) = app.state::<AppState>().current_record_prompt.lock() {
        *current = Some((id.to_string(), occurrence_start_unix));
    }
    window::show_record_prompt(app, view);
}

/// Hide the window and drop its stash — the item went read/retired elsewhere,
/// or (poller.rs) its occurrence is 30 minutes past start.
pub(crate) fn expire_record_prompt(app: &AppHandle, id: &str) {
    let _ = take_record_prompt(id);
    window::hide_record_prompt(app);
}

/// `record_prompt_start` command: "Start recording" tapped on the window.
pub fn record_prompt_start(app: &AppHandle, id: String) {
    window::hide_record_prompt(app);
    let Some(payload) = take_record_prompt(&id) else {
        return;
    };
    start_recording_from_prompt(app, id, payload);
}

/// `record_prompt_open` command: the chevron menu's "Open the note instead".
pub fn record_prompt_open(app: &AppHandle, id: String) {
    window::hide_record_prompt(app);
    let link = take_record_prompt(&id).and_then(|p| p.link);
    on_clicked(app, &id, link.as_deref());
}

/// `record_prompt_dismiss` command: the window's close (x) button. Marks
/// nothing read — the bell item stays unread — it just stops suggesting
/// recording for the rest of this session.
pub fn record_prompt_dismiss(app: &AppHandle, id: String) {
    window::hide_record_prompt(app);
    let _ = take_record_prompt(&id);
    if let Ok(mut dismissed) = app.state::<AppState>().dismissed_record_prompts.lock() {
        dismissed.insert(id);
    }
}

/// `record_prompt_mute` command: the chevron menu's "Don't suggest for this
/// meeting" — same `intent=recordPrompt` POST the web RecordPromptBanner's
/// overflow item makes (calendar.meeting.$id.tsx), turning the prompt off for
/// the whole series.
pub fn record_prompt_mute(app: &AppHandle, id: String) {
    window::hide_record_prompt(app);
    let Some(payload) = take_record_prompt(&id) else {
        return;
    };
    let http = app.state::<AppState>().http.clone();
    tauri::async_runtime::spawn(async move {
        let Some(token) = keychain::get_token() else {
            return;
        };
        let form = reqwest::multipart::Form::new().text("intent", "recordPrompt");
        let _ = http
            .post(config::calendar_meeting_url(&payload.scheduled_meeting_id))
            .bearer_auth(token)
            .multipart(form)
            .send()
            .await;
    });
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

/// Banner action button: `read`, `rsvp:<accepted|tentative|declined>`, or
/// `record`/`open` (a legacy record-prompt banner, macOS only — see the
/// module doc above). Anything else (e.g. the macOS dismiss identifier) is a
/// no-op.
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

/// "Record" tapped on a record prompt (the floating window's
/// `record_prompt_start` command, or a legacy banner's Record action): create
/// the MeetingRecording and start capturing immediately, no deep link and no
/// page open. On any refusal (noteRequired / forbidden / recordingDisabled /
/// 503) or network failure, fall back to opening the item's link — the web
/// page explains why and offers browser recording instead.
pub(crate) fn start_recording_from_prompt(app: &AppHandle, id: String, payload: RecordPromptPayload) {
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
