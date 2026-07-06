// Navigation interception on the main (remote) window — the one place the shell
// watches webview navigation. Two jobs:
//   1. Same-origin `/login` while authenticated → the SSR session lapsed/was
//      revoked. We can't render the web login inside the webview (Google blocks
//      embedded webviews), so re-trigger device pairing instead.
//   2. Cross-origin navigations → open in the system browser, not the webview.

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::{
    config,
    state::{AppState, AuthState},
    window,
};

pub fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    let prod = Url::parse(config::PROD_ORIGIN).expect("valid prod origin");
    let same_origin = url.scheme() == prod.scheme() && url.host_str() == prod.host_str();

    if same_origin {
        if url.path().starts_with("/login") {
            // Only a live, authenticated session lapsing should re-trigger
            // pairing. During explicit sign-out (state Unpaired/LoggedOut) or
            // while already pairing, ignore the redirect rather than reopening
            // the browser.
            if app.state::<AppState>().auth() == AuthState::Authenticated {
                app.state::<AppState>().set_auth(AuthState::WebviewExpired);
                window::show_pairing(app);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::pairing::run(handle).await;
                });
            }
            return false;
        }
        return true;
    }

    // Cross-origin link → system browser; cancel the in-webview navigation.
    let _ = app.opener().open_url(url.to_string(), None::<&str>);
    false
}
