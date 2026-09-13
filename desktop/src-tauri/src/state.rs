use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;

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
    pub title: String,
    pub link: Option<String>,
    pub urgent: bool,
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
    // Latest unread notifications, urgent first — rendered in the tray menu.
    pub recent_notifs: Mutex<Vec<RecentNotif>>,
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            auth: Mutex::new(AuthState::Unpaired),
            pairing_cancel: AtomicBool::new(false),
            seen_notifs: Mutex::new(HashSet::new()),
            recent_notifs: Mutex::new(Vec::new()),
            zoom: Mutex::new(1.0),
            main_load_gen: AtomicU64::new(0),
            main_loaded_gen: AtomicU64::new(0),
            main_revealed: AtomicBool::new(false),
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
