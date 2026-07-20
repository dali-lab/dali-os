// Background notification delivery. Holds the server's SSE stream when it can
// (instant same-machine pushes; the server's periodic `sync` event is the
// cross-instance backstop) and degrades to the original 45s poll cadence
// whenever the stream can't be held. Lives in Rust rather than webview JS
// because OS timers in a hidden webview are suspended.
//
// Each sync fetches /api/notifications with the keychain Bearer token, raises
// native banners for new unread items whose event allows desktop banners
// (Settings → Notifications → Desktop; urgent items get sound), updates the
// dock badge, and hands the latest unread items to the tray menu.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    config, keychain, notify,
    state::{AppState, AuthState, RecentNotif},
    tray, window,
};

fn default_true() -> bool {
    true
}

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
    // Per-item desktop-banner preference and registry urgency, resolved
    // server-side. Absent on older servers → banner everything (the previous
    // behavior).
    #[serde(default = "default_true")]
    desktop: bool,
    #[serde(default)]
    urgent: bool,
    #[serde(rename = "readAt", default)]
    read_at: Option<String>,
}

enum SyncOutcome {
    Ok,
    Unauthorized,
    Err,
}

enum StreamEnd {
    Unauthorized,
    Disconnected,
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

            match sync_once(&app, &http, &token).await {
                SyncOutcome::Unauthorized => return expire(&app),
                SyncOutcome::Ok => interval = config::POLL_INTERVAL_SECS,
                // Network error / 5xx → exponential backoff, capped.
                SyncOutcome::Err => interval = (interval * 2).min(config::POLL_BACKOFF_MAX_SECS),
            }

            // Hold the stream as long as it lives; each change/sync event runs
            // another sync. When it drops (or never connects — e.g. offline),
            // the sleep below makes this loop exactly the old poller.
            match hold_stream(&app, &http, &token).await {
                StreamEnd::Unauthorized => return expire(&app),
                StreamEnd::Disconnected => {}
            }

            tokio::time::sleep(Duration::from_secs(interval)).await;
        }
    });
}

// Keychain Session expired/revoked → stop; surface re-pair.
fn expire(app: &AppHandle) {
    app.state::<AppState>().set_auth(AuthState::TokenExpired);
    notify::raise(
        app,
        "Sign-in expired",
        "Open DALI OS to sign in again.",
        None,
        false,
    );
}

async fn sync_once(app: &AppHandle, http: &reqwest::Client, token: &str) -> SyncOutcome {
    let resp = match http
        .get(config::notifications_url())
        .bearer_auth(token)
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return SyncOutcome::Err,
    };
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return SyncOutcome::Unauthorized;
    }
    if !resp.status().is_success() {
        return SyncOutcome::Err;
    }
    let body = match resp.json::<NotifResp>().await {
        Ok(b) => b,
        Err(_) => return SyncOutcome::Err,
    };

    // Collect new items under the lock, raise after releasing it (never hold
    // a MutexGuard across the badge call/await).
    let mut to_raise: Vec<(String, String, Option<String>, bool)> = Vec::new();
    {
        let st = app.state::<AppState>();
        // Bind the lock Result to a named local so its temporary doesn't
        // outlive `st` (avoids E0597).
        let lock = st.seen_notifs.lock();
        if let Ok(mut seen) = lock {
            let first_run = seen.is_empty();
            for item in &body.items {
                let is_new = seen.insert(item.id.clone());
                if is_new
                    && !first_run
                    && item.desktop
                    && (!item.title.is_empty() || item.link.is_some())
                {
                    to_raise.push((
                        item.title.clone(),
                        item.body.clone().unwrap_or_default(),
                        item.link.clone(),
                        item.urgent,
                    ));
                }
            }
        }
    }
    for (title, body_text, link, urgent) in to_raise {
        notify::raise(app, &title, &body_text, link, urgent);
    }

    // Tray menu: latest unread, urgent bumped to the top (stable sort keeps
    // feed order within each group).
    let mut recent: Vec<RecentNotif> = body
        .items
        .iter()
        .filter(|i| i.read_at.is_none() && !i.title.is_empty())
        .map(|i| RecentNotif {
            title: i.title.clone(),
            link: i.link.clone(),
            urgent: i.urgent,
        })
        .collect();
    recent.sort_by_key(|n| !n.urgent);
    recent.truncate(config::TRAY_RECENT_MAX);
    if let Ok(mut g) = app.state::<AppState>().recent_notifs.lock() {
        *g = recent;
    }

    window::set_badge(app, body.unread_count);
    tray::refresh(app, body.unread_count);
    SyncOutcome::Ok
}

// Hold the SSE stream, running a sync for each server `change`/`sync` event.
// Every failure path returns Disconnected and the caller falls back to
// polling; only a 401 (revoked/expired Session) is surfaced distinctly.
async fn hold_stream(app: &AppHandle, http: &reqwest::Client, token: &str) -> StreamEnd {
    let resp = match http
        .get(config::notifications_stream_url())
        .bearer_auth(token)
        .header("accept", "text/event-stream")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return StreamEnd::Disconnected,
    };
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return StreamEnd::Unauthorized;
    }
    if !resp.status().is_success() {
        return StreamEnd::Disconnected;
    }

    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut event_name = String::new();

    loop {
        // Keepalives arrive every 25s; a longer silence is a dead connection.
        let bytes = match tokio::time::timeout(
            Duration::from_secs(config::STREAM_STALL_SECS),
            stream.next(),
        )
        .await
        {
            Ok(Some(Ok(bytes))) => bytes,
            // Timeout, server close, or transport error → reconnect via caller.
            _ => return StreamEnd::Disconnected,
        };
        buf.extend_from_slice(&bytes);

        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                // Blank line terminates one SSE event.
                let is_cue = event_name == "change" || event_name == "sync";
                event_name.clear();
                if is_cue {
                    if app.state::<AppState>().auth() == AuthState::LoggedOut {
                        return StreamEnd::Disconnected;
                    }
                    if let SyncOutcome::Unauthorized = sync_once(app, http, token).await {
                        return StreamEnd::Unauthorized;
                    }
                }
            } else if let Some(rest) = line.strip_prefix("event:") {
                event_name = rest.trim().to_string();
            }
            // `data:` payloads and `:` comments carry nothing the client uses.
        }
    }
}
