// Frontmost-application detection, used to time the desktop record-prompt
// window (poller.rs): a Zoom or Teams call frontmost means the meeting is
// actually on screen, not just scheduled. macOS only — `frontmostApplication`
// needs no permission grant, unlike Screen Recording (which would be needed
// to detect Google Meet in a browser tab, out of scope here). Other platforms
// have no portable equivalent, so callers fall back to the time-based check.

#[cfg(target_os = "macos")]
const ZOOM_BUNDLE_ID: &str = "us.zoom.xos";
#[cfg(target_os = "macos")]
const TEAMS_BUNDLE_IDS: [&str; 2] = ["com.microsoft.teams2", "com.microsoft.teams"];

/// The frontmost app's bundle identifier, or `None` if it can't be determined
/// (no frontmost app).
#[cfg(target_os = "macos")]
fn bundle_id() -> Option<String> {
    use objc2_app_kit::NSWorkspace;

    let app = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    app.bundleIdentifier().map(|s| s.to_string())
}

/// The frontmost meeting app's display name ("Zoom"/"Teams"), used both to
/// time the record-prompt window (poller.rs) and, when it fires that way, as
/// the window's "source" label. `None` on platforms without `NSWorkspace` —
/// callers fall back to the time-based check.
#[cfg(target_os = "macos")]
pub fn meeting_app_frontmost_name() -> Option<&'static str> {
    let id = bundle_id()?;
    if id == ZOOM_BUNDLE_ID {
        Some("Zoom")
    } else if TEAMS_BUNDLE_IDS.contains(&id.as_str()) {
        Some("Teams")
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
pub fn meeting_app_frontmost_name() -> Option<&'static str> {
    None
}
