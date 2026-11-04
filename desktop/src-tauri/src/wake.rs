// Reload the main window after the Mac wakes from sleep. WKWebView keeps the
// HTTP/2 connection it held before sleep and sends the first requests after
// wake into it; the connection is dead, so they hang until WebKit times out
// and the page sits half-rendered. Chrome drops its sockets on resume, which
// is why the same page recovers in a browser tab. A full reload once the
// network is back starts on a fresh connection.

use std::future::Future;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::state::{AppState, AuthState};

// Wi-Fi usually rejoins a few seconds after wake; give it up to ~30s.
const REACHABLE_ATTEMPTS: u32 = 10;
const REACHABLE_RETRY: Duration = Duration::from_secs(3);

// Reloading would throw away a half-typed field, so leave the page alone when
// one has focus. Collab docs resync on their own websocket.
const RELOAD_UNLESS_EDITING: &str = "(() => { \
    const el = document.activeElement; \
    const editing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' \
        || el.tagName === 'SELECT' || el.isContentEditable); \
    if (!editing) location.reload(); \
})()";

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSWorkspace, NSWorkspaceDidWakeNotification};
    use objc2_foundation::{NSNotification, NSOperationQueue};

    let handle = app.clone();
    let block = RcBlock::new(move |_note: NonNull<NSNotification>| {
        tauri::async_runtime::spawn(on_wake(handle.clone()));
    });
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // The returned observer token lives as long as the app; dropping it does
    // not unregister a block-based observer.
    let _ = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &AppHandle) {}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
async fn on_wake(app: AppHandle) {
    let state = app.state::<AppState>();
    if state.auth() != AuthState::Authenticated || !state.is_revealed() {
        return;
    }
    let probe = app.clone();
    wait_until(
        || {
            let probe = probe.clone();
            async move { crate::window::reachable(&probe).await }
        },
        REACHABLE_ATTEMPTS,
        REACHABLE_RETRY,
    )
    .await;
    // Reload even if the origin never answered: the navigation re-arms the
    // offline watchdog (nav.rs), which lands on the offline page.
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.eval(RELOAD_UNLESS_EDITING);
    }
}

/// Poll `probe` until it returns true, at most `attempts` times with `delay`
/// between tries. Returns whether it ever succeeded.
async fn wait_until<F, Fut>(mut probe: F, attempts: u32, delay: Duration) -> bool
where
    F: FnMut() -> Fut,
    Fut: Future<Output = bool>,
{
    for attempt in 0..attempts {
        if probe().await {
            return true;
        }
        if attempt + 1 < attempts {
            tokio::time::sleep(delay).await;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[tokio::test]
    async fn stops_at_the_first_success() {
        let calls = Cell::new(0);
        let ok = wait_until(
            || {
                calls.set(calls.get() + 1);
                let n = calls.get();
                async move { n == 3 }
            },
            10,
            Duration::ZERO,
        )
        .await;
        assert!(ok);
        assert_eq!(calls.get(), 3);
    }

    #[tokio::test]
    async fn gives_up_after_the_attempt_budget() {
        let calls = Cell::new(0);
        let ok = wait_until(
            || {
                calls.set(calls.get() + 1);
                async { false }
            },
            4,
            Duration::ZERO,
        )
        .await;
        assert!(!ok);
        assert_eq!(calls.get(), 4);
    }

    #[tokio::test]
    async fn succeeds_immediately_without_sleeping() {
        let ok = wait_until(|| async { true }, 1, Duration::from_secs(3600)).await;
        assert!(ok);
    }

    #[tokio::test]
    async fn does_not_sleep_after_the_last_attempt() {
        let start = std::time::Instant::now();
        wait_until(|| async { false }, 1, Duration::from_secs(3600)).await;
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
