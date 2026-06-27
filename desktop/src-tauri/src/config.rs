// Compile-time constants and derived URLs. The shell is hardcoded to the prod
// origin (single build, prod-only — see TAURI_DESKTOP_PLAN.md).

pub const PROD_ORIGIN: &str = "https://os.dali.dartmouth.edu";
pub const DEEP_LINK_SCHEME: &str = "dalios";

// macOS Keychain coordinates for the long-lived desktop Session (the background
// poller's Bearer token).
pub const KEYCHAIN_SERVICE: &str = "edu.dartmouth.dali.os";
pub const KEYCHAIN_TOKEN_ACCOUNT: &str = "desktop-session";

// Notification poll cadence + error backoff cap (seconds).
pub const POLL_INTERVAL_SECS: u64 = 45;
pub const POLL_BACKOFF_MAX_SECS: u64 = 300;

pub fn pair_start_url() -> String {
    format!("{PROD_ORIGIN}/auth/pair/start")
}
pub fn pair_poll_url() -> String {
    format!("{PROD_ORIGIN}/auth/pair/poll")
}
pub fn notifications_url() -> String {
    format!("{PROD_ORIGIN}/api/notifications")
}
pub fn logout_url() -> String {
    format!("{PROD_ORIGIN}/logout")
}
pub fn help_url() -> String {
    format!("{PROD_ORIGIN}/help")
}
