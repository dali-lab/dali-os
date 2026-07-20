// Native banners raised by the background delivery loop. Called directly from
// Rust (not via IPC), so it works even with the main window's IPC fully locked.
//
// macOS calls mac-notification-sys directly — the same NSUserNotification
// machinery tauri-plugin-notification wraps, except its send() surfaces the
// user's response, which the plugin discards (desktop click events are
// mobile-only there). send() parks its thread until the user interacts — a
// click from Notification Center minutes later still resolves — so each banner
// gets its own detached thread, and a click navigates the main window to the
// notification's link. Urgent (time-sensitive) items get the default sound.
//
// Other platforms keep the plugin path: fire-and-forget, no click-through.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub fn raise(app: &AppHandle, title: &str, body: &str, link: Option<String>, urgent: bool) {
    use mac_notification_sys::{Notification, NotificationResponse};

    let app = app.clone();
    let title = if title.is_empty() { "DALI OS" } else { title }.to_string();
    let body = body.to_string();
    std::thread::spawn(move || {
        let mut n = Notification::new();
        n.title(&title);
        if !body.is_empty() {
            n.message(&body);
        }
        if urgent {
            n.sound("default");
        }
        if let Ok(NotificationResponse::Click) = n.send() {
            match &link {
                Some(link) => crate::window::open_link(&app, link),
                None => crate::window::show_main(&app),
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn raise(app: &AppHandle, title: &str, body: &str, link: Option<String>, urgent: bool) {
    use tauri_plugin_notification::NotificationExt;

    let mut builder = app.notification().builder();
    if !title.is_empty() {
        builder = builder.title(title);
    }
    if !body.is_empty() {
        builder = builder.body(body);
    }
    let _ = builder.show();
    let _ = (link, urgent);
}
