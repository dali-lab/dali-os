// XDG desktop-notification backend via notify-rust (D-Bus). The freedesktop
// spec has first-class actions: "default" is the body click; buttons render
// where the notification daemon supports them (GNOME/KDE do; minimal daemons
// drop them and the handle resolves on close instead). wait_for_action parks
// its thread until the daemon reports a response, so each banner gets a
// detached thread.

use tauri::AppHandle;

use super::Banner;

pub fn raise(app: &AppHandle, banner: Banner) {
    use notify_rust::{Notification, Urgency};

    let app = app.clone();
    std::thread::spawn(move || {
        let mut n = Notification::new();
        n.appname("DALI OS");
        n.summary(&banner.title);
        if !banner.body.is_empty() {
            n.body(&banner.body);
        }
        n.action("default", "Open");
        if banner.rsvp {
            n.action(super::ACTION_RSVP_ACCEPT, "Accept");
            n.action(super::ACTION_RSVP_MAYBE, "Maybe");
            n.action(super::ACTION_RSVP_DECLINE, "Decline");
        } else if banner.is_row() {
            n.action(super::ACTION_READ, "Mark read");
        }
        if banner.urgent {
            // Critical stays on screen until addressed — the point of
            // time-sensitive surfacing.
            n.urgency(Urgency::Critical);
        }
        let Ok(handle) = n.show() else {
            return;
        };
        handle.wait_for_action(|action| match action {
            "default" => super::on_clicked(&app, &banner.id, banner.link.as_deref()),
            // Hard-coded notify-rust keyword: closed without action.
            "__closed" => {}
            other => super::on_action(&app, &banner.id, other),
        });
    });
}
