// On-demand "Check for Updates…" from the menu bar. Uses tauri-plugin-updater —
// the same minisign-verified S3 feed the background auto-update path uses — and
// surfaces the result as a native notification.

use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::notify;

pub async fn check_now(app: AppHandle) {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            notify::raise(&app, "Update check failed", &e.to_string(), None);
            return;
        }
    };

    match updater.check().await {
        Ok(Some(update)) => {
            notify::raise(
                &app,
                "Updating DALI OS",
                "Downloading the latest version…",
                None,
            );
            match update.download_and_install(|_chunk, _total| {}, || {}).await {
                // Relaunch into the new version (diverges).
                Ok(_) => app.restart(),
                Err(e) => notify::raise(&app, "Update failed", &e.to_string(), None),
            }
        }
        Ok(None) => notify::raise(&app, "DALI OS", "You're up to date.", None),
        Err(e) => notify::raise(&app, "Update check failed", &e.to_string(), None),
    }
}

/// Silent check at launch: if a newer signed release exists, download + stage it
/// and notify the user to reopen. Quiet on up-to-date / errors so a flaky network
/// never nags. No forced restart — the staged bundle applies on the next launch.
pub async fn check_on_launch(app: AppHandle) {
    let Ok(updater) = app.updater() else {
        return;
    };
    if let Ok(Some(update)) = updater.check().await {
        if update
            .download_and_install(|_chunk, _total| {}, || {})
            .await
            .is_ok()
        {
            notify::raise(
                &app,
                "DALI OS updated",
                "Reopen DALI OS to finish updating.",
                None,
            );
        }
    }
}
