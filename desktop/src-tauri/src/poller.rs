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
//
// Record-prompt items (recordPrompt field) are a special case: they raise the
// floating "Meeting detected" window (notify::raise_record_prompt) instead of
// an OS banner. An item for a Zoom/Teams occurrence (hasVideoLink) is held
// back in AppState.pending_record_prompts rather than raised immediately, and
// a second background loop (spawned alongside the main sync loop, below)
// rechecks every 10s whether the call is now frontmost or the two-minute
// fallback has elapsed — and, while it's at it, whether the window's current
// prompt has aged out (30 minutes past its occurrence start). Items without a
// video link (in-person, Meet) raise right away, same as any other banner.

use std::time::Duration;

use futures_util::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    config, frontmost, keychain,
    notify::{self, Banner, RecordPromptPayload},
    state::{AppState, AuthState, PendingRecordPrompt, RecentNotif},
    tray, window,
};

// Live-call fallback / outer bound for deferred record prompts (desktop only
// — Google Meet in a browser tab can't be frontmost-detected without Screen
// Recording permission, so it always uses the fallback).
const RECORD_PROMPT_RECHECK: Duration = Duration::from_secs(10);
const RECORD_PROMPT_FALLBACK_SECS: i64 = 2 * 60;
const RECORD_PROMPT_DROP_SECS: i64 = 30 * 60;

fn default_true() -> bool {
    true
}

#[derive(Deserialize, Default)]
struct NotifResp {
    #[serde(default)]
    items: Vec<NotifItem>,
    #[serde(rename = "unreadCount", default)]
    unread_count: i64,
    // Rows that left the feed unread because they went stale (a "Starting
    // soon" reminder past its meeting, an invite to a cancelled one). They
    // never come back with readAt set, so the server names them explicitly.
    // Absent on older servers → nothing extra to retire.
    #[serde(rename = "retiredIds", default)]
    retired_ids: Vec<String>,
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
    // Meeting-invite fields: an invite awaiting an RSVP gets RSVP action
    // buttons on its banner.
    #[serde(rename = "scheduledMeetingId", default)]
    scheduled_meeting_id: Option<String>,
    #[serde(default)]
    rsvp: Option<String>,
    // Desktop one-tap record prompt. Absent on every item that isn't a
    // meeting.record_prompt notification.
    #[serde(rename = "recordPrompt", default)]
    record_prompt: Option<RecordPrompt>,
}

#[derive(Deserialize)]
struct RecordPrompt {
    #[serde(rename = "scheduledMeetingId")]
    scheduled_meeting_id: String,
    #[serde(rename = "occurrenceStart")]
    occurrence_start: String,
    // The server resolves/creates the note itself (attachMeetingNote); the
    // window's commands never need this directly, but it rides along in the
    // payload the task's event contract specifies.
    #[serde(rename = "notePageId", default)]
    note_page_id: Option<String>,
    #[serde(rename = "hasVideoLink", default)]
    has_video_link: bool,
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
    tauri::async_runtime::spawn(record_prompt_watcher(app.clone()));
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
    notify::raise_simple(app, "Sign-in expired", "Open DALI OS to sign in again.");
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
    let mut to_raise: Vec<Banner> = Vec::new();
    let mut to_raise_prompts: Vec<(String, RecordPromptPayload)> = Vec::new();
    let mut to_defer: Vec<PendingRecordPrompt> = Vec::new();
    {
        let st = app.state::<AppState>();
        // Bind the lock Result to a named local so its temporary doesn't
        // outlive `st` (avoids E0597).
        let lock = st.seen_notifs.lock();
        if let Ok(mut seen) = lock {
            let first_run = seen.is_empty();
            for item in &body.items {
                let is_new = seen.insert(item.id.clone());
                if !is_new || first_run || !item.desktop {
                    continue;
                }
                if item.title.is_empty() && item.link.is_none() {
                    continue;
                }
                match &item.record_prompt {
                    Some(rp) => queue_record_prompt(item, rp, &mut to_raise_prompts, &mut to_defer),
                    None => to_raise.push(Banner {
                        id: item.id.clone(),
                        title: item.title.clone(),
                        body: item.body.clone().unwrap_or_default(),
                        link: item.link.clone(),
                        urgent: item.urgent,
                        rsvp: item.scheduled_meeting_id.is_some() && item.rsvp.is_none(),
                        record: false,
                    }),
                }
            }
        }
    }
    if !to_defer.is_empty() {
        if let Ok(mut pending) = app.state::<AppState>().pending_record_prompts.lock() {
            pending.extend(to_defer);
        }
    }
    for (id, payload) in to_raise_prompts {
        notify::raise_record_prompt(app, &id, payload);
    }
    for banner in to_raise {
        notify::raise(app, banner);
    }

    // Retire delivered banners two ways. Rows read elsewhere (web, another
    // device, a banner action) come back with readAt set. Rows that went stale
    // instead of being read drop out of the feed entirely, so the server lists
    // them separately — without that, a "Starting soon" banner would sit in
    // Notification Center long after the meeting ended.
    let stale_ids: Vec<String> = body
        .items
        .iter()
        .filter(|i| i.read_at.is_some())
        .map(|i| i.id.clone())
        .chain(body.retired_ids.iter().cloned())
        .collect();
    notify::clear_delivered(&stale_ids);

    // A still-deferred record prompt whose notification went read/retired
    // (the web page marks it read once a recording starts there; the server
    // retires stale rows) must never raise later — drop it and its stash.
    // One already showing in the floating window gets hidden outright.
    if !stale_ids.is_empty() {
        if let Ok(mut pending) = app.state::<AppState>().pending_record_prompts.lock() {
            pending.retain(|p| {
                if stale_ids.contains(&p.id) {
                    let _ = notify::take_record_prompt(&p.id);
                    false
                } else {
                    true
                }
            });
        }
        let shown_stale = app
            .state::<AppState>()
            .current_record_prompt
            .lock()
            .ok()
            .and_then(|g| g.clone())
            .filter(|(id, _)| stale_ids.contains(id))
            .map(|(id, _)| id);
        if let Some(id) = shown_stale {
            notify::expire_record_prompt(app, &id);
        }
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

/// Route one new record-prompt item: raise the floating window now when
/// there's no video link to wait on or the timestamp can't be parsed, else
/// hold it for the 10s recheck loop below.
fn queue_record_prompt(
    item: &NotifItem,
    rp: &RecordPrompt,
    to_raise: &mut Vec<(String, RecordPromptPayload)>,
    to_defer: &mut Vec<PendingRecordPrompt>,
) {
    if rp.has_video_link {
        if let Some(occurrence_start_unix) = parse_iso8601_unix(&rp.occurrence_start) {
            to_defer.push(PendingRecordPrompt {
                id: item.id.clone(),
                title: item.title.clone(),
                link: item.link.clone(),
                note_page_id: rp.note_page_id.clone(),
                scheduled_meeting_id: rp.scheduled_meeting_id.clone(),
                occurrence_start: rp.occurrence_start.clone(),
                occurrence_start_unix,
            });
            return;
        }
        // Unparseable timestamp: fall through and raise immediately rather
        // than silently dropping the prompt.
    }
    to_raise.push((
        item.id.clone(),
        RecordPromptPayload {
            title: item.title.clone(),
            // No frontmost detection on the immediate path — there was no
            // video link to wait on, or the timestamp didn't parse.
            source: None,
            note_page_id: rp.note_page_id.clone(),
            link: item.link.clone(),
            scheduled_meeting_id: rp.scheduled_meeting_id.clone(),
            occurrence_start: rp.occurrence_start.clone(),
        },
    ));
}

/// Every 10s: raise a deferred record prompt once Zoom/Teams is frontmost or
/// the two-minute fallback has elapsed (whichever first), drop anything
/// nobody's call started within 30 minutes of the occurrence start, and hide
/// the window if the prompt it's currently showing has itself aged past that
/// same 30-minute bound. Runs for the life of the session alongside the main
/// sync loop (spawned by `spawn` above), stopping once signed out.
async fn record_prompt_watcher(app: AppHandle) {
    loop {
        tokio::time::sleep(RECORD_PROMPT_RECHECK).await;
        if app.state::<AppState>().auth() != AuthState::Authenticated {
            return;
        }
        check_pending_record_prompts(&app);
    }
}

fn check_pending_record_prompts(app: &AppHandle) {
    let now = now_unix();
    let frontmost = frontmost::meeting_app_frontmost_name();
    let live = frontmost.is_some();

    let mut due: Vec<PendingRecordPrompt> = Vec::new();
    {
        let st = app.state::<AppState>();
        let Ok(mut pending) = st.pending_record_prompts.lock() else {
            return;
        };
        pending.retain(|p| {
            let age = now - p.occurrence_start_unix;
            if age > RECORD_PROMPT_DROP_SECS {
                false // too late — drop unraised
            } else if live || age >= RECORD_PROMPT_FALLBACK_SECS {
                due.push(p.clone());
                false
            } else {
                true
            }
        });
    }

    for p in due {
        notify::raise_record_prompt(
            app,
            &p.id,
            RecordPromptPayload {
                title: p.title,
                source: frontmost.map(str::to_string),
                note_page_id: p.note_page_id,
                link: p.link,
                scheduled_meeting_id: p.scheduled_meeting_id,
                occurrence_start: p.occurrence_start,
            },
        );
    }

    expire_shown_record_prompt(app, now);
}

/// Auto-hide the floating window once its own occurrence is 30 minutes past
/// start, same outer bound as an unraised pending prompt above.
fn expire_shown_record_prompt(app: &AppHandle, now: i64) {
    let Some((id, start_unix)) = app
        .state::<AppState>()
        .current_record_prompt
        .lock()
        .ok()
        .and_then(|g| g.clone())
    else {
        return;
    };
    if now - start_unix > RECORD_PROMPT_DROP_SECS {
        notify::expire_record_prompt(app, &id);
    }
}

fn now_unix() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Parses a UTC ISO-8601 timestamp (`Date.toISOString()` output, e.g.
/// `2026-10-09T14:30:00.000Z`) into Unix seconds. No date/time crate: the
/// format is fixed-width and always UTC, so a hand-rolled parser covers the
/// one comparison this needs (minute-scale, so sub-second precision is
/// irrelevant) without a new dependency. `pub(crate)`: notify.rs reuses it to
/// pre-parse a record prompt's occurrence start when raising the window.
pub(crate) fn parse_iso8601_unix(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;

    // Everything after the whole seconds is optional fractional seconds
    // and/or a timezone offset; default to UTC if neither is present.
    let rest = &s[19..];
    let offset_minutes: i64 = if rest.contains(['Z', 'z']) {
        0
    } else if let Some(pos) = rest.find(['+', '-']) {
        let sign = if rest.as_bytes()[pos] == b'-' { -1 } else { 1 };
        let off = &rest[pos + 1..];
        let oh: i64 = off.get(0..2)?.parse().ok()?;
        let om: i64 = off.get(3..5).and_then(|m| m.parse().ok()).unwrap_or(0);
        sign * (oh * 60 + om)
    } else {
        0
    };

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60)
}

/// Howard Hinnant's days-from-civil algorithm (proleptic Gregorian days
/// since the Unix epoch).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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
