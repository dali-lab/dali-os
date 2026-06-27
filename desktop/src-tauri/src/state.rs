use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
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
}

impl AppState {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::new(),
            auth: Mutex::new(AuthState::Unpaired),
            pairing_cancel: AtomicBool::new(false),
            seen_notifs: Mutex::new(HashSet::new()),
        }
    }

    pub fn set_auth(&self, next: AuthState) {
        if let Ok(mut guard) = self.auth.lock() {
            *guard = next;
        }
    }

    pub fn auth(&self) -> AuthState {
        self.auth.lock().map(|g| *g).unwrap_or(AuthState::Unpaired)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
