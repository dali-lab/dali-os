// Native notifications raised by the background poller. Called directly from
// Rust (not via IPC), so it works even with the main window's IPC fully locked.
//
// Desktop notification click-through (clicking a banner → navigate to the
// notification's `link`) is limited in tauri-plugin-notification on desktop; the
// reliable click-through path is the `dalios://` deep link (see deeplink.rs).
// The `link` is reserved here for when richer desktop action support lands.

use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

pub fn raise(app: &AppHandle, title: &str, body: &str, link: Option<String>) {
    let mut builder = app.notification().builder();
    if !title.is_empty() {
        builder = builder.title(title);
    }
    if !body.is_empty() {
        builder = builder.body(body);
    }
    let _ = builder.show();
    let _ = link;
}
