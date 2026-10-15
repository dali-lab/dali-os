use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;

use crate::tray_model::TrayView;

// `AppState.connection` values (tray.rs/poller.rs set these; tray.rs reads
// them into tray_model::Connection for the view).
pub const CONNECTION_LIVE: u8 = 0;
pub const CONNECTION_POLLING: u8 = 1;
pub const CONNECTION_OFFLINE: u8 = 2;

// The shell's auth/session lifecycle. Fieldless variants serialize to their name
// (e.g. "Pairing"), which the pairing UI compares against.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AuthState {
    Unpaired,
    Pairing,
    Authenticated,
    WebviewExpired,
    TokenExpired,
    LoggedOut,
}

// One tray-menu entry for a recent unread notification. Maintained by the
// delivery loop (poller.rs); the tray menu handler resolves clicks against
// this list by index.
#[derive(Clone)]
pub struct RecentNotif {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
    pub urgent: bool,
}

// A record-prompt notification (poller.rs) held back because its meeting has
// a Zoom/Teams link: raised (as the floating record-prompt window, not an OS
// banner) once the call is actually frontmost or the fallback window elapses,
// whichever comes first (dropped, unraised, past the 30-minute outer bound).
// `occurrence_start_unix` is parsed once at enqueue time so the 10s recheck
// is a cheap integer comparison.
#[derive(Clone)]
pub struct PendingRecordPrompt {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
    pub note_page_id: Option<String>,
    pub scheduled_meeting_id: String,
    pub occurrence_start: String,
    pub occurrence_start_unix: i64,
}

// The next upcoming meeting/interview, as fetched from /api/desktop/agenda
// (poller.rs). ISO timestamps are kept as given — tray_model parses them
// against `now_unix` when building the view.
#[derive(Clone)]
pub struct AgendaNext {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub join_url: Option<String>,
    pub link: Option<String>,
    pub note_page_id: Option<String>,
    pub can_record: bool,
}

// One open to-do (form to fill, agreement to sign, …) from the notifications
// payload's `tasks` array.
#[derive(Clone)]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
}

pub struct AppState {
    // Cheap to clone (Arc inside) — clone out before awaiting rather than
    // holding a State guard across .await.
    pub http: reqwest::Client,
    pub auth: Mutex<AuthState>,
    // Set true to abort an in-flight pairing poll loop.
    pub pairing_cancel: AtomicBool,
    // Notification ids already surfaced this session — dedupe so a steady poll
    // doesn't re-alert the same item.
    pub seen_notifs: Mutex<HashSet<String>>,
    // Latest unread notifications, as delivered (unsorted/untruncated) —
    // tray_model derives the tray menu/panel's ordered, capped view from
    // this plus `unread_count` below.
    pub recent_notifs: Mutex<Vec<RecentNotif>>,
    // Unread count from the last notifications sync — read by tray::refresh
    // to build the tray/panel view.
    pub unread_count: AtomicI64,
    // The tray/panel's last-built view, kept so a freshly-opened panel
    // window can render immediately and so the tray menu handler can resolve
    // a "recent:<id>" click without re-deriving the view.
    pub tray_view: Mutex<Option<TrayView>>,
    // Tray icon rect from the last panel open, so a content-driven resize can
    // re-anchor the panel to the icon (Windows grows upward).
    pub tray_anchor: Mutex<Option<tauri::Rect>>,
    // When the panel was last hidden. A tray click that lands right after a
    // blur-hide is the same click that caused the blur, so toggle must not
    // re-open on it.
    pub tray_hidden_at: Mutex<Option<std::time::Instant>>,
    // Webview zoom factor (View → Zoom). In-memory; resets to 1.0 on restart.
    pub zoom: Mutex<f64>,
    // Remote-load tracking, so a failed/hung load of the prod origin can fall
    // back to the bundled offline page instead of a blank webview.
    // `main_load_gen` is bumped each time a load is armed; `main_loaded_gen`
    // catches up to it when a prod page actually finishes loading. A watchdog
    // that armed at gen N treats "loaded_gen < N" as "still not loaded".
    pub main_load_gen: AtomicU64,
    pub main_loaded_gen: AtomicU64,
    // Whether the main window has been shown to the user yet (gates the
    // cold-start splash → app / offline reveal, and is idempotent).
    pub main_revealed: AtomicBool,
    // Id of the MeetingRecording being captured, if any (recording.rs). Also
    // drives the tray's "Stop recording" item.
    pub recording: Mutex<Option<String>>,
    // Record prompts deferred until their Zoom/Teams call is actually
    // frontmost (or the fallback timer elapses). See poller.rs.
    pub pending_record_prompts: Mutex<Vec<PendingRecordPrompt>>,
    // Notification id of the prompt the floating record-prompt window is
    // currently showing, if any, paired with its occurrence's start (Unix
    // seconds) so the 10s watcher (poller.rs) can auto-hide it 30 minutes
    // past start without re-touching the notify:: stash.
    pub current_record_prompt: Mutex<Option<(String, i64)>>,
    // The view JSON last pushed to the record-prompt window, kept so the
    // page can pull it on load (`record_prompt_get_view`): on the first raise
    // of a session the `record-prompt://show` emit races the webview's
    // script and is lost.
    pub record_prompt_view: Mutex<Option<serde_json::Value>>,
    // Notification ids the user explicitly closed (the window's X) this
    // session — a defensive guard against a second raise for the same id;
    // cleared on sign-out like the other per-session delivery state above.
    pub dismissed_record_prompts: Mutex<HashSet<String>>,
    // Meeting title for the active recording (recording.rs has no title of
    // its own — only a MeetingRecording id). Set when a recording starts
    // from a record prompt or the tray's "Record" button, cleared when it
    // stops.
    pub recording_title: Mutex<Option<String>>,
    // Latest value from /api/desktop/agenda (poller.rs), or None if there's
    // no upcoming meeting.
    pub agenda: Mutex<Option<AgendaNext>>,
    // Latest open to-dos from the notifications payload's `tasks` field.
    pub tasks: Mutex<Vec<TaskItem>>,
    pub task_count: AtomicI64,
    // CONNECTION_LIVE/POLLING/OFFLINE — set by poller.rs's sync loop.
    pub connection: AtomicU8,
    pub last_sync: Mutex<Option<Instant>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            auth: Mutex::new(AuthState::Unpaired),
            pairing_cancel: AtomicBool::new(false),
            seen_notifs: Mutex::new(HashSet::new()),
            recent_notifs: Mutex::new(Vec::new()),
            unread_count: AtomicI64::new(0),
            tray_view: Mutex::new(None),
            tray_anchor: Mutex::new(None),
            tray_hidden_at: Mutex::new(None),
            zoom: Mutex::new(1.0),
            main_load_gen: AtomicU64::new(0),
            main_loaded_gen: AtomicU64::new(0),
            main_revealed: AtomicBool::new(false),
            recording: Mutex::new(None),
            pending_record_prompts: Mutex::new(Vec::new()),
            current_record_prompt: Mutex::new(None),
            record_prompt_view: Mutex::new(None),
            dismissed_record_prompts: Mutex::new(HashSet::new()),
            recording_title: Mutex::new(None),
            agenda: Mutex::new(None),
            tasks: Mutex::new(Vec::new()),
            task_count: AtomicI64::new(0),
            connection: AtomicU8::new(CONNECTION_POLLING),
            last_sync: Mutex::new(None),
        }
    }

    /// Arm a new load attempt; returns its generation. A watchdog spawned for
    /// this generation compares it against `loaded_since` after its timeout.
    pub fn arm_load(&self) -> u64 {
        self.main_load_gen.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// A prod page finished loading — catch `main_loaded_gen` up to the latest
    /// armed generation so any pending watchdog sees the load.
    pub fn mark_loaded(&self) {
        self.main_loaded_gen
            .store(self.main_load_gen.load(Ordering::SeqCst), Ordering::SeqCst);
    }

    /// Has a prod page finished loading at or after generation `gen`?
    pub fn loaded_since(&self, gen: u64) -> bool {
        self.main_loaded_gen.load(Ordering::SeqCst) >= gen
    }

    /// Mark the main window as shown; returns the previous value so callers can
    /// run reveal side effects (hide splash, focus) exactly once.
    pub fn mark_revealed(&self) -> bool {
        self.main_revealed.swap(true, Ordering::SeqCst)
    }

    pub fn is_revealed(&self) -> bool {
        self.main_revealed.load(Ordering::SeqCst)
    }

    pub fn set_auth(&self, next: AuthState) {
        if let Ok(mut guard) = self.auth.lock() {
            *guard = next;
        }
    }

    pub fn auth(&self) -> AuthState {
        self.auth.lock().map(|g| *g).unwrap_or(AuthState::Unpaired)
    }

    /// Adjust the webview zoom by `delta`, clamped to a sane range; returns the
    /// new factor.
    pub fn bump_zoom(&self, delta: f64) -> f64 {
        let mut g = self.zoom.lock().unwrap_or_else(|e| e.into_inner());
        *g = (*g + delta).clamp(0.5, 3.0);
        *g
    }

    pub fn reset_zoom(&self) -> f64 {
        let mut g = self.zoom.lock().unwrap_or_else(|e| e.into_inner());
        *g = 1.0;
        *g
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
