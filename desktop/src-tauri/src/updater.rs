// On-demand "Check for Updates…" from the menu bar. Uses tauri-plugin-updater —
// the same minisign-verified S3 feed the background auto-update path uses — and
// surfaces the result as a native notification.

use std::time::Duration;

use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::{config, keychain, notify, state::AppState};

// Background re-check cadence. The window closes to tray (keeping the poller
// alive), so a machine can run for weeks without a relaunch; a daily check keeps
// resident installs from stranding on an old build the way a launch-only check
// would. Matches the once-a-day default of updaters like Sparkle.
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

// Bound the audit-report POST so a hung network never delays the restart it
// precedes on the manual path.
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);

pub async fn check_now(app: AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            notify::raise_simple(&app, "Update check failed", &e.to_string());
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            let from = app.package_info().version.to_string();
            let to = update.version.clone();
            notify::raise_simple(&app, "Updating DALI OS", "Downloading the latest version…");
            match update.download_and_install(|_chunk, _total| {}, || {}).await {
                Ok(_) => {
                    report_installed(&app, &from, &to).await;
                    // Relaunch into the new version (diverges).
                    app.restart();
                }
                Err(e) => notify::raise_simple(&app, "Update failed", &e.to_string()),
            }
        }
        Ok(None) => notify::raise_simple(&app, "DALI OS", "You're up to date."),
        Err(e) => notify::raise_simple(&app, "Update check failed", &e.to_string()),
    }
}

/// Background updater: checks at launch, then once a day for the life of the
/// process. Each check silently downloads + stages a newer signed release and
/// nudges the user to reopen; quiet on up-to-date / errors so a flaky network
/// never nags. No forced restart — a staged bundle applies on the next launch,
/// so once one is staged there's nothing more to do until then.
pub async fn run_periodic(app: AppHandle) {
    loop {
        if check_and_stage(&app).await {
            return;
        }
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}

/// One silent check. Returns true once a newer release has been downloaded and
/// staged (nothing more to gain until relaunch), false on up-to-date / any error.
async fn check_and_stage(app: &AppHandle) -> bool {
    let Ok(updater) = app.updater() else {
        return false;
    };
    if let Ok(Some(update)) = updater.check().await {
        let from = app.package_info().version.to_string();
        let to = update.version.clone();
        if update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .is_ok()
        {
            report_installed(app, &from, &to).await;
            notify::raise_simple(app, "DALI OS updated", "Reopen DALI OS to finish updating.");
            return true;
        }
    }
    false
}

/// Best-effort: tell the server an update installed so it lands in the audit
/// trail (the download itself is client↔S3, off-server). Fire-and-forget with a
/// bounded timeout — a failed report never blocks or reverses the update.
async fn report_installed(app: &AppHandle, from: &str, to: &str) {
    let Some(token) = keychain::get_token() else {
        return;
    };
    let http = app.state::<AppState>().http.clone();
    let _ = http
        .post(config::desktop_updated_url())
        .bearer_auth(token)
        .timeout(REPORT_TIMEOUT)
        .json(&serde_json::json!({ "from": from, "to": to }))
        .send()
        .await;
}
