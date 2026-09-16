// Compile-time constants and derived URLs. The shell is hardcoded to the prod
// origin (single build, prod-only — see TAURI_DESKTOP_PLAN.md).

pub const PROD_ORIGIN: &str = "https://os.dali.dartmouth.edu";
pub const DEEP_LINK_SCHEME: &str = "dalios";

// Bundled frontend assets (frontendDist) are served from the Tauri custom
// protocol. On macOS/Linux that origin is `tauri://localhost`; this app ships
// macOS only. The offline fallback page lives here so a failed remote load can
// swap the main window to it without a network round-trip.
pub const APP_ASSET_ORIGIN: &str = "tauri://localhost";

// Cold-start reveal fallback: the page load normally reveals the window; if the
// load-finished signal is missed (an occluded webview can defer its load), show
// the window anyway this long after the reachability probe clears.
pub const BOOT_REVEAL_MAX_SECS: u64 = 6;
// After a load is armed, how long before we probe reachability and, only if the
// origin is truly unreachable, swap to the offline page.
pub const OFFLINE_WATCH_SECS: u64 = 12;
// Reachability probe timeout — kept short so the offline decision is prompt.
pub const OFFLINE_PROBE_TIMEOUT_SECS: u64 = 5;

// macOS Keychain coordinates for the long-lived desktop Session (the background
// poller's Bearer token).
pub const KEYCHAIN_SERVICE: &str = "edu.dartmouth.dali.os";
pub const KEYCHAIN_TOKEN_ACCOUNT: &str = "desktop-session";

// Notification poll cadence + error backoff cap (seconds). Polling is the
// fallback when the SSE stream can't be held.
pub const POLL_INTERVAL_SECS: u64 = 45;
pub const POLL_BACKOFF_MAX_SECS: u64 = 300;
// The stream sends a keepalive every 25s; treat a longer silence as a dead
// connection and reconnect.
pub const STREAM_STALL_SECS: u64 = 90;
// Unread notifications listed in the tray menu.
pub const TRAY_RECENT_MAX: usize = 5;

pub fn pair_start_url() -> String {
    format!("{PROD_ORIGIN}/auth/pair/start")
}
pub fn pair_poll_url() -> String {
    format!("{PROD_ORIGIN}/auth/pair/poll")
}
pub fn notifications_url() -> String {
    format!("{PROD_ORIGIN}/api/notifications")
}
pub fn notifications_stream_url() -> String {
    format!("{PROD_ORIGIN}/api/notifications/stream")
}
pub fn desktop_updated_url() -> String {
    format!("{PROD_ORIGIN}/api/desktop/updated")
}
pub fn logout_url() -> String {
    format!("{PROD_ORIGIN}/logout")
}
pub fn help_url() -> String {
    format!("{PROD_ORIGIN}/help")
}
pub fn offline_url() -> String {
    format!("{APP_ASSET_ORIGIN}/offline.html")
}
