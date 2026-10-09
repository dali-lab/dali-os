// Native meeting recording. A meeting-note page (in this app or in any
// browser) creates a MeetingRecording on the server and opens
// `dalios://record?id=<id>`; that link lands here via deeplink.rs. We record
// the Mac's system audio plus the mic with the Swift recorder linked in by
// build.rs (recorder/Recorder.swift), which converts each source to 16 kHz
// mono Int16 PCM and hands it back on two channels (0 = mic, 1 = call). We
// batch each channel into 20 s (640,000 byte) chunks and POST them to
// /api/meeting-recordings/:id/chunks; the server runs transcription and
// speaker diarization once the recording stops. The page polls the same row.
//
// Trust: a dalios:// link can come from any website, so the id is never taken
// on faith. The claim action is the ownership check: the server answers
// non-success unless the row belongs to this token's user, and the mic stays
// closed.
// Ids are only minted by the user's own page (SameSite=Lax session), so a
// third party can't produce one that passes.
//
// One recording at a time. Stop comes from the page (the server's
// stopRequested, seen on our 5 s poll or a chunk response), the tray menu, or
// the recorder failing on its own. The page's Continue re-opens the same id:
// the server hands back a new segment index and this session's chunks are
// numbered from seq 0 within it.

use std::collections::VecDeque;
use std::ffi::{c_char, CStr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, watch, Notify};

use crate::{config, keychain, notify, state::AppState, tray};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_EVERY: Duration = Duration::from_secs(5);
// 20 s at 16 kHz mono 16-bit PCM.
const CHUNK_BYTES: usize = 640_000;
const MAX_QUEUED_CHUNKS: usize = 20;
const MAX_BACKOFF: Duration = Duration::from_secs(30);
// Bound on draining each channel's upload queue once the recorder has
// stopped, so an unreachable server doesn't hang the finish/stop calls
// forever. The uploader task itself is aborted past this point.
const FINAL_DRAIN_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Event {
    Started {
        #[serde(rename = "systemAudio")]
        system_audio: bool,
    },
    Error {
        message: String,
    },
    Stopped,
}

#[derive(Deserialize, Default)]
struct ClaimResp {
    // Seconds recorded by earlier sessions of this recording (Continue).
    #[serde(default)]
    #[allow(dead_code)]
    offset: f64,
    #[serde(default)]
    segment: u32,
}

#[derive(Deserialize, Default)]
struct ChunkResp {
    #[serde(rename = "stopRequested", default)]
    stop_requested: bool,
}

#[derive(Deserialize, Default)]
struct RecordingView {
    #[serde(rename = "stopRequested", default)]
    stop_requested: bool,
}

// (channel, PCM bytes), channel 0 = mic, 1 = call.
type AudioChunk = (u8, Vec<u8>);

// The Swift side calls back on its own threads; these are the hops onto the
// recording task.
static EVENTS: Mutex<Option<mpsc::UnboundedSender<String>>> = Mutex::new(None);
static AUDIO: Mutex<Option<mpsc::UnboundedSender<AudioChunk>>> = Mutex::new(None);

#[cfg(target_os = "macos")]
extern "C" {
    fn dali_recorder_start(callback: extern "C" fn(*const c_char));
    fn dali_recorder_stop();
    fn dali_recorder_set_audio_callback(callback: extern "C" fn(u8, *const i16, usize));
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

extern "C" fn on_audio(channel: u8, ptr: *const i16, count: usize) {
    if ptr.is_null() || count == 0 {
        return;
    }
    // Int16 is already the wire format (16 kHz mono signed little-endian);
    // macOS is little-endian on every architecture we ship.
    let samples = unsafe { std::slice::from_raw_parts(ptr, count) };
    let mut bytes = Vec::with_capacity(count * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    if let Ok(guard) = AUDIO.lock() {
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send((channel, bytes));
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
    let chunks_url = config::recording_chunks_url(id);

    // Ownership check before the mic opens. Silent on a link that isn't ours.
    let claim = match post(&http, &url, &token, json!({ "action": "claim" })).await {
        Ok(r) if r.status().is_success() => r.json::<ClaimResp>().await.unwrap_or_default(),
        _ => return Ok(()),
    };
    let segment = claim.segment;

    if !cfg!(target_os = "macos") {
        let _ = post(
            &http,
            &url,
            &token,
            json!({ "action": "finish", "error": "Recording needs the DALI OS app for Mac." }),
        )
        .await;
        let _ = post(&http, &url, &token, json!({ "action": "stop", "final": true })).await;
        return Ok(());
    }

    let (tx_events, mut rx_events) = mpsc::unbounded_channel::<String>();
    if let Ok(mut guard) = EVENTS.lock() {
        *guard = Some(tx_events);
    }
    let (tx_audio, mut rx_audio) = mpsc::unbounded_channel::<AudioChunk>();
    if let Ok(mut guard) = AUDIO.lock() {
        *guard = Some(tx_audio);
    }

    #[cfg(target_os = "macos")]
    unsafe {
        dali_recorder_set_audio_callback(on_audio);
        dali_recorder_start(on_event);
    }
    let session_started = Instant::now();
    tray::rebuild_menu(app);

    let (stop_tx, mut stop_rx) = watch::channel(false);

    let mic_queue = ChunkQueue::new();
    let call_queue = ChunkQueue::new();
    let mic_upload = tokio::spawn(run_uploader(
        http.clone(),
        chunks_url.clone(),
        token.clone(),
        "mic",
        segment,
        mic_queue.clone(),
        stop_tx.clone(),
    ));
    let call_upload = tokio::spawn(run_uploader(
        http.clone(),
        chunks_url.clone(),
        token.clone(),
        "call",
        segment,
        call_queue.clone(),
        stop_tx.clone(),
    ));

    let mut mic_acc = ChannelAccumulator::new(mic_queue);
    let mut call_acc = ChannelAccumulator::new(call_queue);

    let mut capture_error: Option<String> = None;
    let mut stop_sent = false;
    let mut poll_tick = tokio::time::interval(POLL_EVERY);
    poll_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            changed = stop_rx.changed() => {
                if changed.is_ok() && *stop_rx.borrow() && !stop_sent {
                    stop_sent = true;
                    stop();
                }
            }
            msg = rx_events.recv() => {
                match msg {
                    None => break,
                    Some(msg) => match serde_json::from_str::<Event>(&msg) {
                        Ok(Event::Started { system_audio }) => {
                            let body = if system_audio {
                                "Recording this Mac's audio and your mic."
                            } else {
                                "Recording your mic. System audio needs macOS 14.2 or later."
                            };
                            notify::raise_simple(app, "Recording this meeting", body);
                        }
                        Ok(Event::Error { message }) => capture_error = Some(message),
                        Ok(Event::Stopped) => break,
                        Err(_) => {}
                    },
                }
            }
            audio = rx_audio.recv() => {
                if let Some((channel, bytes)) = audio {
                    if channel == 0 {
                        mic_acc.push(bytes);
                    } else {
                        call_acc.push(bytes);
                    }
                }
            }
            _ = poll_tick.tick() => {
                if poll_stop_requested(&http, &url, &token).await {
                    let _ = stop_tx.send(true);
                }
            }
        }
    }

    if let Ok(mut guard) = EVENTS.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = AUDIO.lock() {
        *guard = None;
    }

    // Flush each channel's remaining partial chunk (short is fine, the
    // server accepts up to 700 KB) and let the uploaders drain their queues.
    mic_acc.finish();
    call_acc.finish();
    // A timeout here just means the task is left detached; best-effort, we
    // move on to finish/stop regardless so the recording still finalizes.
    let _ = tokio::time::timeout(FINAL_DRAIN_TIMEOUT, mic_upload).await;
    let _ = tokio::time::timeout(FINAL_DRAIN_TIMEOUT, call_upload).await;

    let seconds = session_started.elapsed().as_secs_f64();
    let _ = post(
        &http,
        &url,
        &token,
        json!({ "action": "finish", "error": capture_error.clone(), "seconds": seconds }),
    )
    .await;
    let _ = post(&http, &url, &token, json!({ "action": "stop", "final": true })).await;

    match capture_error {
        Some(message) => Err(message),
        None => Ok(()),
    }
}

// Per-channel chunking + upload.

/// Accumulates raw PCM bytes for one channel and slices off fixed-size
/// chunks as they fill, handing each to the channel's upload queue.
struct ChannelAccumulator {
    buffer: Vec<u8>,
    next_seq: u32,
    queue: Arc<ChunkQueue>,
}

impl ChannelAccumulator {
    fn new(queue: Arc<ChunkQueue>) -> Self {
        Self { buffer: Vec::with_capacity(CHUNK_BYTES), next_seq: 0, queue }
    }

    fn push(&mut self, bytes: Vec<u8>) {
        self.buffer.extend_from_slice(&bytes);
        while self.buffer.len() >= CHUNK_BYTES {
            let chunk = self.buffer.drain(..CHUNK_BYTES).collect();
            self.queue.push(self.next_seq, chunk);
            self.next_seq += 1;
        }
    }

    /// Flush whatever partial chunk remains and close the queue so its
    /// uploader task exits once it has drained.
    fn finish(&mut self) {
        if !self.buffer.is_empty() {
            let chunk = std::mem::take(&mut self.buffer);
            self.queue.push(self.next_seq, chunk);
            self.next_seq += 1;
        }
        self.queue.close();
    }
}

// (seq, chunk bytes), plus whether the queue has been closed (no more
// pushes coming).
type QueueState = (VecDeque<(u32, Vec<u8>)>, bool);

/// A bounded (drop-oldest), closeable queue of `(seq, bytes)` chunks shared
/// between the accumulator (producer) and the uploader task (sole consumer).
struct ChunkQueue {
    state: Mutex<QueueState>,
    notify: Notify,
}

impl ChunkQueue {
    fn new() -> Arc<Self> {
        Arc::new(Self { state: Mutex::new((VecDeque::new(), false)), notify: Notify::new() })
    }

    fn push(&self, seq: u32, bytes: Vec<u8>) {
        if let Ok(mut guard) = self.state.lock() {
            guard.0.push_back((seq, bytes));
            while guard.0.len() > MAX_QUEUED_CHUNKS {
                guard.0.pop_front();
            }
        }
        self.notify.notify_one();
    }

    fn close(&self) {
        if let Ok(mut guard) = self.state.lock() {
            guard.1 = true;
        }
        self.notify.notify_one();
    }

    /// Waits for the next chunk, or returns `None` once closed and drained.
    async fn next(&self) -> Option<(u32, Vec<u8>)> {
        loop {
            {
                let mut guard = self.state.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(item) = guard.0.pop_front() {
                    return Some(item);
                }
                if guard.1 {
                    return None;
                }
            }
            self.notify.notified().await;
        }
    }
}

enum ChunkUpload {
    Ok { stop_requested: bool },
    Gone,
    Retry,
}

/// Drains `queue` one chunk at a time (one in-flight upload per channel),
/// retrying a failed upload with exponential backoff before moving on.
async fn run_uploader(
    http: reqwest::Client,
    chunks_url: String,
    token: String,
    channel: &'static str,
    segment: u32,
    queue: Arc<ChunkQueue>,
    stop_tx: watch::Sender<bool>,
) {
    while let Some((seq, bytes)) = queue.next().await {
        let mut delay = Duration::from_secs(1);
        loop {
            match upload_chunk(&http, &chunks_url, &token, channel, segment, seq, &bytes).await {
                ChunkUpload::Ok { stop_requested } => {
                    if stop_requested {
                        let _ = stop_tx.send(true);
                    }
                    break;
                }
                ChunkUpload::Gone => {
                    let _ = stop_tx.send(true);
                    break;
                }
                ChunkUpload::Retry => {
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(MAX_BACKOFF);
                }
            }
        }
    }
}

async fn upload_chunk(
    http: &reqwest::Client,
    chunks_url: &str,
    token: &str,
    channel: &str,
    segment: u32,
    seq: u32,
    bytes: &[u8],
) -> ChunkUpload {
    let segment_s = segment.to_string();
    let seq_s = seq.to_string();
    let resp = http
        .post(chunks_url)
        .query(&[("channel", channel), ("segment", segment_s.as_str()), ("seq", seq_s.as_str())])
        .bearer_auth(token)
        .header(reqwest::header::CONTENT_TYPE, "audio/pcm;rate=16000;channels=1")
        .timeout(REQUEST_TIMEOUT)
        .body(bytes.to_vec())
        .send()
        .await;

    let Ok(resp) = resp else { return ChunkUpload::Retry };
    match resp.status() {
        reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::CONFLICT => ChunkUpload::Gone,
        s if s.is_success() => {
            let body = resp.json::<ChunkResp>().await.unwrap_or_default();
            ChunkUpload::Ok { stop_requested: body.stop_requested }
        }
        _ => ChunkUpload::Retry,
    }
}

/// 5 s heartbeat while no chunk is ready to report: a GET never carries an
/// empty POST body, it just checks whether the page asked to stop.
async fn poll_stop_requested(http: &reqwest::Client, url: &str, token: &str) -> bool {
    let Ok(resp) = http.get(url).bearer_auth(token).timeout(REQUEST_TIMEOUT).send().await else {
        return false;
    };
    if !resp.status().is_success() {
        return false;
    }
    resp.json::<RecordingView>().await.map(|r| r.stop_requested).unwrap_or(false)
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
