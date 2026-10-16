// `dalios://` deep-link routing. Wired to BOTH the single-instance handler
// (cold start / second launch argv) and the deep-link plugin's on_open_url
// (running instance). A notification click that fires `dalios://notify?link=/x`
// focuses the window and navigates the webview to the target route.
// `dalios://record?id=<id>` starts a native meeting recording (recording.rs),
// from a meeting note open in this app or in any browser.
// `dalios://copy?url=<https url>` writes a prod-origin page URL to the clipboard
// without touching any window.

use tauri::{AppHandle, Manager};
use url::Url;

use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::{config, nav, recording, window};

pub fn handle_urls(app: &AppHandle, urls: &[Url]) {
    for u in urls {
        if u.scheme() != config::DEEP_LINK_SCHEME {
            continue;
        }
        if u.host_str() == Some("record") {
            if let Some(id) = u.query_pairs().find(|(k, _)| k == "id") {
                recording::start(app, id.1.into_owned());
            }
            continue;
        }
        if u.host_str() == Some("copy") {
            if let Some(text) = copy_target(u) {
                let _ = app.clipboard().write_text(text);
            }
            continue;
        }
        let target = u
            .query_pairs()
            .find(|(k, _)| k == "link" || k == "path")
            .map(|(_, v)| v.into_owned());

        match target {
            Some(path) => window::open_link(app, &path),
            None => window::show_main(app),
        }
    }
}

fn copy_target(u: &Url) -> Option<String> {
    let raw = u.query_pairs().find(|(k, _)| k == "url")?.1.into_owned();
    let parsed = Url::parse(&raw).ok()?;
    nav::is_prod_origin(&parsed).then_some(raw)
}

pub fn from_argv(app: &AppHandle, argv: &[String]) {
    let urls: Vec<Url> = argv
        .iter()
        .filter_map(|a| Url::parse(a).ok())
        .filter(|u| u.scheme() == config::DEEP_LINK_SCHEME)
        .collect();
    if !urls.is_empty() {
        handle_urls(app, &urls);
        return;
    }
    // Plain second launch → focus the appropriate window.
    let main_visible = app
        .get_webview_window("main")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if main_visible {
        window::show_main(app);
    } else {
        window::show_pairing(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy(q: &str) -> Option<String> {
        copy_target(&Url::parse(&format!("dalios://copy{q}")).unwrap())
    }

    #[test]
    fn accepts_prod_url() {
        let page = format!("{}/projects/1?tab=a", config::PROD_ORIGIN);
        let enc = url::form_urlencoded::byte_serialize(page.as_bytes()).collect::<String>();
        assert_eq!(copy(&format!("?url={enc}")), Some(page));
    }

    #[test]
    fn rejects_missing_param() {
        assert_eq!(copy(""), None);
        assert_eq!(copy("?link=%2Fx"), None);
    }

    #[test]
    fn rejects_foreign_origin() {
        assert_eq!(copy("?url=https%3A%2F%2Fevil.example%2Fx"), None);
    }

    #[test]
    fn rejects_other_schemes() {
        assert_eq!(copy("?url=javascript%3Aalert(1)"), None);
        assert_eq!(copy("?url=file%3A%2F%2F%2Fetc%2Fpasswd"), None);
        assert_eq!(copy("?url=not+a+url"), None);
    }
}
