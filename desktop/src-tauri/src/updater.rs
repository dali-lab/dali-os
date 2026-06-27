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
