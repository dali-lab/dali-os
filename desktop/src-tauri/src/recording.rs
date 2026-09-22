// Native meeting recording. A meeting-note page (in this app or in any
// browser) creates a MeetingRecording on the server and opens
// `dalios://record?id=<id>`; that link lands here via deeplink.rs. We record
// the Mac's system audio plus the mic with the Swift recorder linked in by
// build.rs (recorder/Recorder.swift), which transcribes on-device, and stream
// the recognized lines to /api/meeting-recordings/:id with the keychain Bearer
// token. The page polls that same row.
//
// Trust: a dalios:// link can come from any website, so the id is never taken
// on faith. The first append is also the ownership check: the server answers
// 404 unless the row belongs to this token's user, and the mic stays closed.
// Ids are only minted by the user's own page (SameSite=Lax session), so a
// third party can't produce one that passes.
//
// One recording at a time. Stop comes from the page (the server's
// stopRequested, seen on our next append), the tray menu, or the recorder
// failing on its own. The page's Continue re-opens the same id: the server
// hands back the seconds already recorded, and this session's lines are
// stamped from there.

use std::ffi::{c_char, CStr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use crate::{config, keychain, notify, state::AppState, tray};

const FLUSH_EVERY: Duration = Duration::from_secs(2);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Event {
    Started {
        #[serde(rename = "systemAudio")]
        system_audio: bool,
    },
    Line {
        source: String,
        at: f64,
        text: String,
    },
    Error {
        message: String,
    },
    Stopped,
}

#[derive(Deserialize)]
struct AppendResp {
    #[serde(rename = "stopRequested", default)]
    stop_requested: bool,
    // Seconds recorded by earlier sessions of this recording (Continue).
    #[serde(default)]
    offset: f64,
}

// The Swift side calls back on its own threads; this is the hop onto the
// recording task.
static EVENTS: Mutex<Option<mpsc::UnboundedSender<String>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
extern "C" {
    fn dali_recorder_start(callback: extern "C" fn(*const c_char));
    fn dali_recorder_stop();
}

extern "C" fn on_event(json: *const c_char) {
    if json.is_null() {
        return;
    }
    let s = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    if let Ok(guard) = EVENTS.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(s);
        }
    }
}

/// Handle a `dalios://record?id=…` link.
pub fn start(app: &AppHandle, id: String) {
    // Server ids are cuids; anything else is not ours to put in a URL.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return;
    }
    {
        let state = app.state::<AppState>();
        let Ok(mut current) = state.recording.lock() else {
            return;
        };
        if let Some(active) = current.as_ref() {
            if *active != id {
                notify::raise_simple(app, "Already recording", "Stop the current recording first.");
            }
            return;
        }
        *current = Some(id.clone());
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = record(&app, &id).await;
        if let Ok(mut current) = app.state::<AppState>().recording.lock() {
            *current = None;
        }
        tray::rebuild_menu(&app);
        if let Err(message) = result {
            notify::raise_simple(&app, "Recording stopped", &message);
        }
    });
}

/// Stop the active recording, if any (tray menu, or the page via the server).
pub fn stop() {
    #[cfg(target_os = "macos")]
    unsafe {
        dali_recorder_stop()
    };
}

async fn record(app: &AppHandle, id: &str) -> Result<(), String> {
    let token = keychain::get_token().ok_or("Sign in to the DALI OS app to record.")?;
    let http = app.state::<AppState>().http.clone();
    let url = config::recording_url(id);

    // Ownership check before the mic opens. Silent on a link that isn't ours.
    let offset = match post(&http, &url, &token, json!({ "action": "append", "lines": [] })).await {
        Ok(r) if r.status().is_success() => r.json::<AppendResp>().await.map(|r| r.offset).unwrap_or(0.0),
        _ => return Ok(()),
    };

    if !cfg!(target_os = "macos") {
        let _ = post(&http, &url, &token, json!({ "action": "finish", "error": "Recording needs the DALI OS app for Mac." })).await;
        return Ok(());
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    if let Ok(mut guard) = EVENTS.lock() {
        *guard = Some(tx);
    }
    #[cfg(target_os = "macos")]
    unsafe {
        dali_recorder_start(on_event)
    };
    let session_started = Instant::now();
    tray::rebuild_menu(app);

    let mut pending: Vec<Value> = Vec::new();
    let mut system_audio: Option<bool> = None;
    let mut error: Option<String> = None;
    let mut stop_sent = false;
    let mut tick = tokio::time::interval(FLUSH_EVERY);

    loop {
        tokio::select! {
            msg = rx.recv() => {
                let Some(msg) = msg else { break };
                match serde_json::from_str::<Event>(&msg) {
                    Ok(Event::Started { system_audio: sys }) => {
                        system_audio = Some(sys);
                        let body = if sys {
                            "Transcribing this Mac's audio and your mic."
                        } else {
                            "Transcribing your mic. System audio needs macOS 14.2 or later."
                        };
                        notify::raise_simple(app, "Recording this meeting", body);
                    }
                    Ok(Event::Line { source, at, text }) => {
                        pending.push(json!({ "source": source, "at": offset + at, "text": text }));
                    }
                    Ok(Event::Error { message }) => error = Some(message),
                    Ok(Event::Stopped) => break,
                    Err(_) => {}
                }
            }
            _ = tick.tick() => {
                if flush(&http, &url, &token, &mut pending, system_audio).await && !stop_sent {
                    stop_sent = true;
                    stop();
                }
            }
        }
    }

    if let Ok(mut guard) = EVENTS.lock() {
        *guard = None;
    }
    // Last phrases: a few tries, since losing the end of a meeting is worse
    // than a slow stop.
    for _ in 0..3 {
        flush(&http, &url, &token, &mut pending, system_audio).await;
        if pending.is_empty() {
            break;
        }
        tokio::time::sleep(FLUSH_EVERY).await;
    }
    let seconds = session_started.elapsed().as_secs_f64();
    let _ = post(
        &http,
        &url,
        &token,
        json!({ "action": "finish", "error": error.clone(), "seconds": seconds }),
    )
    .await;
    match error {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

/// Send buffered lines (or just a heartbeat). Returns true when the recording
/// should stop: the page asked, or the row is gone (discarded on the page).
async fn flush(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    pending: &mut Vec<Value>,
    system_audio: Option<bool>,
) -> bool {
    let mut body = json!({ "action": "append", "lines": pending.clone() });
    if let Some(sys) = system_audio {
        body["systemAudio"] = json!(sys);
    }
    let Ok(resp) = post(http, url, token, body).await else {
        return false; // offline: keep the lines for the next tick
    };
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        pending.clear();
        return true;
    }
    if !resp.status().is_success() {
        return false;
    }
    pending.clear();
    resp.json::<AppendResp>().await.map(|r| r.stop_requested).unwrap_or(false)
}

async fn post(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    body: Value,
) -> reqwest::Result<reqwest::Response> {
    http.post(url)
        .bearer_auth(token)
        .timeout(REQUEST_TIMEOUT)
        .json(&body)
        .send()
        .await
}
