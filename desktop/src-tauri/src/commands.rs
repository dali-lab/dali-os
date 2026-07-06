// IPC commands. App-defined commands are only reachable from the local pairing
// window (the remote main window has no IPC grant). The background poller calls
// the underlying Rust functions directly, not through IPC.

use tauri::{AppHandle, Manager, State};

use crate::{
    config, keychain, pairing,
    state::{AppState, AuthState},
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
