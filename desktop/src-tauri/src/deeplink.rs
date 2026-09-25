// `dalios://` deep-link routing. Wired to BOTH the single-instance handler
// (cold start / second launch argv) and the deep-link plugin's on_open_url
// (running instance). A notification click that fires `dalios://notify?link=/x`
// focuses the window and navigates the webview to the target route.
// `dalios://record?id=<id>` starts a native meeting recording (recording.rs),
// from a meeting note open in this app or in any browser.

use tauri::{AppHandle, Manager};
use url::Url;

use crate::{config, recording, window};

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
