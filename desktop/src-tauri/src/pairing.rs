// Device-pairing orchestration. Drives the GitHub-CLI-style flow entirely from
// Rust so the high-entropy deviceCode and the keychain token never touch JS:
//   start → open system browser → poll → store keychain token → navigate the
//   webview to /auth/handoff (plants the cookie) → show the app, spawn poller.
// Progress is pushed to the pairing UI via `pairing://state` events.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::{
    config, keychain, poller,
    state::{AppState, AuthState},
    window,
};

#[derive(Deserialize)]
struct StartResp {
    #[serde(rename = "deviceCode")]
    device_code: String,
    #[serde(rename = "userCode")]
    user_code: String,
    #[serde(rename = "verificationUrl")]
    verification_url: String,
    #[serde(default)]
    interval: u64,
}

#[derive(Deserialize)]
struct PollResp {
    status: String,
    #[serde(rename = "desktopToken")]
    desktop_token: Option<String>,
    #[serde(rename = "handoffUrl")]
    handoff_url: Option<String>,
}

fn emit_state(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit_to("pairing", "pairing://state", payload);
}

fn device_label() -> String {
    #[cfg(target_os = "macos")]
    {
        let host = std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Mac".to_string());
        format!("{host} · macOS")
    }
    #[cfg(target_os = "linux")]
    {
        let host = std::fs::read_to_string("/etc/hostname")
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|_| "Linux".to_string());
        format!("{host} · Linux")
    }
    #[cfg(target_os = "windows")]
    {
        let host = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Windows".to_string());
        format!("{host} · Windows")
    }
}

pub async fn run(app: AppHandle) {
    let http = app.state::<AppState>().http.clone();
    app.state::<AppState>()
        .pairing_cancel
        .store(false, Ordering::SeqCst);
    app.state::<AppState>().set_auth(AuthState::Pairing);
    emit_state(&app, json!({ "status": "starting" }));

    let start = match start_pairing(&http).await {
        Ok(s) => s,
        Err(e) => {
            emit_state(&app, json!({ "status": "error", "message": e.to_string() }));
            app.state::<AppState>().set_auth(AuthState::Unpaired);
            return;
        }
    };

    emit_state(
        &app,
        json!({
            "status": "awaiting_approval",
            "userCode": start.user_code,
            "verificationUrl": start.verification_url,
        }),
    );
    let _ = app
        .opener()
        .open_url(start.verification_url.clone(), None::<&str>);

    let mut interval = if start.interval > 0 { start.interval } else { 5 };
    loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if app.state::<AppState>().pairing_cancel.load(Ordering::SeqCst) {
            return;
        }
        match poll_pairing(&http, &start.device_code).await {
            Ok(poll) => match poll.status.as_str() {
                "approved" => {
                    if let (Some(token), Some(handoff)) = (poll.desktop_token, poll.handoff_url) {
                        let _ = keychain::store_token(&token);
                        emit_state(&app, json!({ "status": "planting" }));
                        // Plant the cookie session in the webview jar, then reveal it.
                        window::navigate_main(&app, &handoff);
                        app.state::<AppState>().set_auth(AuthState::Authenticated);
                        emit_state(&app, json!({ "status": "paired" }));
                        window::show_main(&app);
                        window::hide_pairing(&app);
                        poller::spawn(app.clone());
                    }
                    return;
                }
                "slow_down" => interval += 2,
                "pending" => {}
                _ => {
                    // denied / expired / already_used
                    emit_state(&app, json!({ "status": "expired" }));
                    app.state::<AppState>().set_auth(AuthState::Unpaired);
                    return;
                }
            },
            // Network/transient error → back off, keep trying (user can Cancel).
            Err(_) => interval = (interval + 5).min(30),
        }
    }
}

async fn start_pairing(http: &reqwest::Client) -> reqwest::Result<StartResp> {
    http.post(config::pair_start_url())
        .json(&json!({ "deviceLabel": device_label() }))
        .send()
        .await?
        .error_for_status()?
        .json::<StartResp>()
        .await
}

async fn poll_pairing(http: &reqwest::Client, device_code: &str) -> reqwest::Result<PollResp> {
    http.post(config::pair_poll_url())
        .json(&json!({ "deviceCode": device_code }))
        .send()
        .await?
        .error_for_status()?
        .json::<PollResp>()
        .await
}
