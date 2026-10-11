// IPC commands. App-defined commands are only reachable from the local pairing
// window (the remote main window has no IPC grant). The background poller calls
// the underlying Rust functions directly, not through IPC.

use tauri::{AppHandle, Manager, State};

use crate::{
    config, keychain, notify, pairing, recording,
    state::{AppState, AuthState},
    tray,
    tray_model::{TitleMode, TrayView},
    window,
};

#[tauri::command]
pub async fn pairing_start(app: AppHandle) -> Result<(), String> {
    pairing::run(app).await;
    Ok(())
}

#[tauri::command]
pub fn pairing_cancel(state: State<'_, AppState>) {
    state
        .pairing_cancel
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state.set_auth(AuthState::Unpaired);
}

#[tauri::command]
pub fn get_auth_state(state: State<'_, AppState>) -> AuthState {
    state.auth()
}

#[tauri::command]
pub async fn sign_out(app: AppHandle) -> Result<(), String> {
    do_sign_out(app).await;
    Ok(())
}

// Record-prompt window commands (record-prompt.html/.js) — invokable only
// from that local window (record-prompt-local.json). The id-keyed ones
// delegate straight to notify.rs, which owns the stash they key off of;
// `record_prompt_set_expanded` only resizes the frame for the chevron menu.
#[tauri::command]
pub fn record_prompt_start(app: AppHandle, id: String) {
    notify::record_prompt_start(&app, id);
}

#[tauri::command]
pub fn record_prompt_open(app: AppHandle, id: String) {
    notify::record_prompt_open(&app, id);
}

#[tauri::command]
pub fn record_prompt_dismiss(app: AppHandle, id: String) {
    notify::record_prompt_dismiss(&app, id);
}

#[tauri::command]
pub fn record_prompt_mute(app: AppHandle, id: String) {
    notify::record_prompt_mute(&app, id);
}

#[tauri::command]
pub fn record_prompt_set_expanded(app: AppHandle, expanded: bool) {
    window::set_record_prompt_expanded(&app, expanded);
}

// Tray panel commands (frontend/tray.{html,js}) — invokable only from that
// local window (capabilities/tray-local.json).
#[tauri::command]
pub fn tray_get_view(state: State<'_, AppState>) -> Option<TrayView> {
    state.tray_view.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn tray_open_link(app: AppHandle, id: String) {
    window::hide_tray_panel(&app);
    let link = app
        .state::<AppState>()
        .tray_view
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .and_then(|v| v.unread.into_iter().find(|r| r.id == id))
        .and_then(|r| r.link);
    match link {
        Some(link) => window::open_link(&app, &link),
        None => window::show_main(&app),
    }
    notify::mark_read(&app, &id);
}

#[tauri::command]
pub fn tray_mark_all_read(app: AppHandle) {
    notify::post(&app, config::notifications_url(), Some(serde_json::json!({})));
}

#[tauri::command]
pub fn tray_open_app(app: AppHandle) {
    window::hide_tray_panel(&app);
    window::show_main(&app);
}

#[tauri::command]
pub fn tray_open_settings(app: AppHandle) {
    window::hide_tray_panel(&app);
    window::open_link(&app, "/settings/notifications");
}

#[tauri::command]
pub fn tray_stop_recording() {
    recording::stop();
}

#[tauri::command]
pub fn tray_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn tray_panel_hide(app: AppHandle) {
    window::hide_tray_panel(&app);
}

#[tauri::command]
pub fn tray_panel_set_height(app: AppHandle, height: f64) {
    window::set_tray_panel_height(&app, height);
}

/// "Join call" on the tray panel's Up next card — same http(s)-only
/// validation as `open_external`, reused directly rather than duplicated.
#[tauri::command]
pub fn tray_open_external(app: AppHandle, url: String) -> Result<(), String> {
    window::hide_tray_panel(&app);
    open_external(app, url)
}

/// Any tray panel row/button that navigates the main window to an app-
/// relative path (Up next's Notes, a to-do row, the "+" menu's Meeting/
/// Document). `path` must start with "/" — never an absolute URL or a
/// custom scheme.
#[tauri::command]
pub fn tray_open_path(app: AppHandle, path: String) -> Result<(), String> {
    if !path.starts_with('/') {
        return Err("refused non-absolute path".into());
    }
    window::hide_tray_panel(&app);
    window::open_link(&app, &path);
    Ok(())
}

/// "Record" on the tray panel's Up next card — starts recording the agenda's
/// current next meeting (sourced from AppState, not the caller, since this
/// is a mutating action).
#[tauri::command]
pub fn tray_record_next(app: AppHandle) {
    window::hide_tray_panel(&app);
    let next = app.state::<AppState>().agenda.lock().ok().and_then(|g| g.clone());
    if let Some(next) = next.filter(|n| n.can_record) {
        recording::start_for_occurrence(&app, next.id, next.starts_at, next.title);
    }
}

/// The panel's "Menu bar shows" segmented control.
#[tauri::command]
pub fn tray_set_title_mode(app: AppHandle, mode: String) {
    let Some(mode) = TitleMode::parse(&mode) else {
        return;
    };
    if let Ok(mut g) = app.state::<AppState>().title_mode.lock() {
        *g = mode;
    }
    tray::save_title_mode(&app, mode);
    tray::refresh(&app);
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    // Only http(s) — never file:// or a custom scheme, even from trusted UI.
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("refused non-http(s) url".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

// Sign out: revoke BOTH credentials and return to the pairing screen.
pub async fn do_sign_out(app: AppHandle) {
    app.state::<AppState>().set_auth(AuthState::LoggedOut);

    let http = app.state::<AppState>().http.clone();
    if let Some(token) = keychain::get_token() {
        // Revoke the keychain (poller) Session server-side.
        let _ = http
            .post(config::logout_url())
            .bearer_auth(&token)
            .send()
            .await;
    }
    keychain::delete_token();
    window::set_badge(&app, 0);
    // Reset per-user delivery state so the next pairing starts clean: an empty
    // seen set re-arms first-run banner suppression for the new account.
    {
        let st = app.state::<AppState>();
        // Named locals for the lock Results so their temporaries don't outlive
        // `st` (same E0597 dance as the poller).
        let seen_lock = st.seen_notifs.lock();
        if let Ok(mut seen) = seen_lock {
            seen.clear();
        }
        let recent_lock = st.recent_notifs.lock();
        if let Ok(mut recent) = recent_lock {
            recent.clear();
        }
        let pending_lock = st.pending_record_prompts.lock();
        if let Ok(mut pending) = pending_lock {
            pending.clear();
        }
        let current_prompt_lock = st.current_record_prompt.lock();
        if let Ok(mut current) = current_prompt_lock {
            *current = None;
        }
        let dismissed_lock = st.dismissed_record_prompts.lock();
        if let Ok(mut dismissed) = dismissed_lock {
            dismissed.clear();
        }
        st.unread_count.store(0, std::sync::atomic::Ordering::SeqCst);
        let tray_view_lock = st.tray_view.lock();
        if let Ok(mut tray_view) = tray_view_lock {
            *tray_view = None;
        }
        let recording_title_lock = st.recording_title.lock();
        if let Ok(mut recording_title) = recording_title_lock {
            *recording_title = None;
        }
        let agenda_lock = st.agenda.lock();
        if let Ok(mut agenda) = agenda_lock {
            *agenda = None;
        }
        let tasks_lock = st.tasks.lock();
        if let Ok(mut tasks) = tasks_lock {
            tasks.clear();
        }
        st.task_count.store(0, std::sync::atomic::Ordering::SeqCst);
    }
    tray::refresh(&app);
    notify::clear_all_delivered();
    notify::clear_record_prompts();
    window::hide_record_prompt(&app);
    window::hide_tray_panel(&app);

    // Revoke the webview cookie Session too: /logout reads the cookie, revokes
    // it, and clears it. Its redirect to /login is ignored by nav.rs because the
    // state is no longer Authenticated.
    window::navigate_main(&app, &config::logout_url());
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    window::show_pairing(&app);
    app.state::<AppState>().set_auth(AuthState::Unpaired);
}
