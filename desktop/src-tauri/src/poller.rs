// Background notification poller. A tokio task that polls /api/notifications
// with the keychain Bearer token even when the window is hidden/in tray, raises
// native notifications for new unread items, and updates the dock badge. OS
// timers in a hidden webview are suspended, which is exactly why this lives in
// Rust rather than webview JS.

use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    config, keychain, notify,
    state::{AppState, AuthState},
    window,
};

#[derive(Deserialize, Default)]
struct NotifResp {
    #[serde(default)]
    items: Vec<NotifItem>,
    #[serde(rename = "unreadCount", default)]
    unread_count: i64,
}

#[derive(Deserialize)]
struct NotifItem {
    id: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    link: Option<String>,
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let http = app.state::<AppState>().http.clone();
        let mut interval = config::POLL_INTERVAL_SECS;

        loop {
            if app.state::<AppState>().auth() == AuthState::LoggedOut {
                return;
            }
            let token = match keychain::get_token() {
                Some(t) => t,
                None => return,
            };

            match http
                .get(config::notifications_url())
                .bearer_auth(&token)
                .send()
                .await
            {
                Ok(resp) if resp.status() == reqwest::StatusCode::UNAUTHORIZED => {
                    // Keychain Session expired/revoked → stop; surface re-pair.
                    app.state::<AppState>().set_auth(AuthState::TokenExpired);
                    notify::raise(
                        &app,
                        "Sign-in expired",
                        "Open DALI OS to sign in again.",
                        None,
                    );
                    return;
                }
                Ok(resp) if resp.status().is_success() => {
                    if let Ok(body) = resp.json::<NotifResp>().await {
                        // Collect new items under the lock, raise after releasing
                        // it (never hold a MutexGuard across the badge call/await).
                        let mut to_raise: Vec<(String, String, Option<String>)> = Vec::new();
                        {
                            let st = app.state::<AppState>();
                            // Bind the lock Result to a named local so its
                            // temporary doesn't outlive `st` (avoids E0597).
                            let lock = st.seen_notifs.lock();
                            if let Ok(mut seen) = lock {
                                let first_run = seen.is_empty();
                                for item in &body.items {
                                    let is_new = seen.insert(item.id.clone());
                                    if is_new
                                        && !first_run
                                        && (!item.title.is_empty() || item.link.is_some())
                                    {
                                        to_raise.push((
                                            item.title.clone(),
                                            item.body.clone().unwrap_or_default(),
                                            item.link.clone(),
                                        ));
                                    }
                                }
                            }
                        }
                        for (title, body_text, link) in to_raise {
                            notify::raise(&app, &title, &body_text, link);
                        }
                        window::set_badge(&app, body.unread_count);
                    }
                    interval = config::POLL_INTERVAL_SECS;
                }
                // Network error / 5xx → exponential backoff, capped.
                _ => interval = (interval * 2).min(config::POLL_BACKOFF_MAX_SECS),
            }

            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}
