// WinRT toast backend via tauri-winrt-notification. on_activated reports the
// clicked button's action string (empty for a body click) while the process
// runs — we're tray-resident, so effectively always; a click from Action
// Center after a full Quit is lost (would need a COM activator, not wired
// up). The AUMID must match what the installer registered a shortcut for —
// Tauri uses the bundle identifier.

use tauri::AppHandle;

use super::Banner;

pub fn raise(app: &AppHandle, banner: Banner) {
    use tauri_winrt_notification::{Sound, Toast};

    let app_id = app.config().identifier.clone();
    let handler_app = app.clone();
    let id = banner.id.clone();
    let link = banner.link.clone();

    let mut toast = Toast::new(&app_id).title(&banner.title);
    if !banner.body.is_empty() {
        toast = toast.text1(&banner.body);
    }
    if banner.rsvp {
        toast = toast
            .add_button("Accept", super::ACTION_RSVP_ACCEPT)
            .add_button("Maybe", super::ACTION_RSVP_MAYBE)
            .add_button("Decline", super::ACTION_RSVP_DECLINE);
    } else if banner.is_row() {
        toast = toast.add_button("Mark read", super::ACTION_READ);
    }
    if banner.urgent {
        toast = toast.sound(Some(Sound::Default));
    } else {
        toast = toast.sound(None);
    }
    let toast = toast.on_activated(move |action| {
        match action.as_deref() {
            None | Some("") => super::on_clicked(&handler_app, &id, link.as_deref()),
            Some(other) => super::on_action(&handler_app, &id, other),
        }
        Ok(())
    });
    let _ = toast.show();
}
