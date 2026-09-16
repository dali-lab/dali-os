// Navigation interception on the main (remote) window — the one place the shell
// watches webview navigation. Jobs:
//   1. The bundled offline page (Tauri asset scheme) → load in the webview.
//   2. Same-origin `/login` while authenticated → the SSR session lapsed/was
//      revoked. We can't render the web login inside the webview (Google blocks
//      embedded webviews), so re-trigger device pairing instead.
//   3. Other same-origin navigations → allow, and re-arm the offline watchdog
//      (so a retry that lands unreachable falls back to the offline page again).
//   4. Cross-origin navigations → open in the system browser, not the webview.

use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::{
    config,
    state::{AppState, AuthState},
    window,
};

pub fn is_prod_origin(url: &Url) -> bool {
    let prod = Url::parse(config::PROD_ORIGIN).expect("valid prod origin");
    url.scheme() == prod.scheme() && url.host_str() == prod.host_str()
}

/// The prod page finished loading — record it (so a pending offline watchdog
/// stands down) and reveal the main window if this is the first load.
pub fn on_page_finished(app: &AppHandle, url: &Url) {
    if !is_prod_origin(url) {
        return;
    }
    app.state::<AppState>().mark_loaded();
    window::reveal_main(app);
}

pub fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    // The bundled offline fallback (`tauri://localhost/offline.html`) must load
    // in the webview, not get shunted to the browser as a "cross-origin" link.
    // Match on scheme (App assets aren't http) or the specific path — no prod
    // route is `/offline.html`, so this can't shadow a real page.
    if url.scheme() != "http" && url.scheme() != "https" {
        if url.scheme() == config::APP_ASSET_ORIGIN.split(':').next().unwrap_or("tauri")
            || url.path() == "/offline.html"
        {
            return true;
        }
        // Other non-web schemes (mailto:, tel:, dalios: …) → hand off to the OS.
        let _ = app.opener().open_url(url.to_string(), None::<&str>);
        return false;
    }

    if is_prod_origin(url) {
        if url.path().starts_with("/login") {
            // A lapsed session should re-trigger pairing. `Authenticated` is the
            // live-session case; `TokenExpired` is the poller having already seen
            // the keychain token revoked (it only raised a banner) — without this
            // the user lands on the embedded /login, which Google blocks, with no
            // way forward. `WebviewExpired` is excluded so a second /login while
            // pairing is already in flight doesn't spawn a duplicate run; explicit
            // sign-out (Unpaired/LoggedOut) and active pairing are ignored too.
            let auth = app.state::<AppState>().auth();
            if matches!(auth, AuthState::Authenticated | AuthState::TokenExpired) {
                app.state::<AppState>().set_auth(AuthState::WebviewExpired);
                window::show_pairing(app);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::pairing::run(handle).await;
                });
            }
            return false;
        }
        // Re-arm the offline watchdog for any post-launch navigation (e.g. the
        // Retry link on the offline page, or a click made after the connection
        // dropped): if this load doesn't finish and the origin is unreachable,
        // we swap back to the offline page. Skipped before first reveal — the
        // cold-start path owns that watchdog.
        if app.state::<AppState>().is_revealed() {
            window::arm_offline_watchdog(app);
        }
        return true;
    }

    // Cross-origin http(s) link → system browser; cancel the in-webview nav.
    let _ = app.opener().open_url(url.to_string(), None::<&str>);
    false
}
