// Pure tray/panel view-model. Takes a plain snapshot of app state (no
// AppHandle, so no Tauri runtime needed) and derives everything the tray
// icon (title/tooltip/menu) and the panel window render. Keeping this out of
// tray.rs makes the ordering/truncation/filtering rules unit-testable
// directly, without a running app.

use serde::Serialize;

use crate::config;
use crate::state::RecentNotif;

// Keeps long notification titles from blowing out the menu/panel width.
const TITLE_MAX_CHARS: usize = 44;

pub struct TraySnapshot {
    pub unread_count: i64,
    pub notifs: Vec<RecentNotif>,
    // Meeting title if cheaply available, empty string if recording but the
    // title isn't known from this state, None if not recording at all.
    pub recording: Option<String>,
    pub version: String,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrayView {
    pub unread_count: i64,
    pub unread: Vec<UnreadRow>,
    pub recording: Option<RecordingView>,
    pub version: String,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UnreadRow {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
    pub urgent: bool,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordingView {
    pub title: String,
}

fn truncated(s: &str) -> String {
    if s.chars().count() <= TITLE_MAX_CHARS {
        return s.to_string();
    }
    let cut: String = s.chars().take(TITLE_MAX_CHARS - 1).collect();
    format!("{cut}…")
}

/// Rows with an empty title are dropped (nothing to show), urgent rows are
/// bumped to the front (stable, so feed order is preserved within each
/// group), and the result is capped at `config::TRAY_RECENT_MAX`.
pub fn build(s: &TraySnapshot) -> TrayView {
    let mut rows: Vec<&RecentNotif> = s.notifs.iter().filter(|n| !n.title.is_empty()).collect();
    rows.sort_by_key(|n| !n.urgent);
    rows.truncate(config::TRAY_RECENT_MAX);

    let unread = rows
        .into_iter()
        .map(|n| UnreadRow {
            id: n.id.clone(),
            title: truncated(&n.title),
            link: n.link.clone(),
            urgent: n.urgent,
        })
        .collect();

    TrayView {
        unread_count: s.unread_count,
        unread,
        recording: s.recording.clone().map(|title| RecordingView { title }),
        version: s.version.clone(),
    }
}

pub fn title(v: &TrayView) -> Option<String> {
    if v.unread_count > 0 {
        Some(v.unread_count.to_string())
    } else {
        None
    }
}

pub fn tooltip(v: &TrayView) -> String {
    if v.unread_count <= 0 {
        return "DALI OS".to_string();
    }
    let urgent = v.unread.iter().filter(|r| r.urgent).count();
    if urgent > 0 {
        format!("{} unread, {} urgent", v.unread_count, urgent)
    } else {
        format!("{} unread", v.unread_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notif(id: &str, title: &str, urgent: bool) -> RecentNotif {
        RecentNotif { id: id.to_string(), title: title.to_string(), link: None, urgent }
    }

    fn snapshot(notifs: Vec<RecentNotif>) -> TraySnapshot {
        TraySnapshot {
            unread_count: notifs.len() as i64,
            notifs,
            recording: None,
            version: "1.2.3".to_string(),
        }
    }

    #[test]
    fn empty_snapshot_builds_empty_view() {
        let s = TraySnapshot {
            unread_count: 0,
            notifs: Vec::new(),
            recording: None,
            version: "1.0.0".to_string(),
        };
        let v = build(&s);
        assert_eq!(v.unread_count, 0);
        assert!(v.unread.is_empty());
        assert_eq!(v.recording, None);
        assert_eq!(v.version, "1.0.0");
    }

    #[test]
    fn urgent_rows_move_first_and_order_is_stable() {
        let s = snapshot(vec![
            notif("1", "a", false),
            notif("2", "b", true),
            notif("3", "c", false),
            notif("4", "d", true),
        ]);
        let v = build(&s);
        let ids: Vec<&str> = v.unread.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["2", "4", "1", "3"]);
    }

    #[test]
    fn title_at_exactly_44_chars_is_not_truncated() {
        let title = "a".repeat(44);
        let s = snapshot(vec![notif("1", &title, false)]);
        let v = build(&s);
        assert_eq!(v.unread[0].title, title);
    }

    #[test]
    fn title_at_45_chars_is_truncated_with_ellipsis() {
        let title = "a".repeat(45);
        let s = snapshot(vec![notif("1", &title, false)]);
        let v = build(&s);
        let expected = format!("{}…", "a".repeat(43));
        assert_eq!(v.unread[0].title, expected);
        assert_eq!(v.unread[0].title.chars().count(), 44);
    }

    #[test]
    fn caps_at_tray_recent_max() {
        let notifs: Vec<RecentNotif> =
            (0..(config::TRAY_RECENT_MAX + 5)).map(|i| notif(&i.to_string(), "t", false)).collect();
        let s = snapshot(notifs);
        let v = build(&s);
        assert_eq!(v.unread.len(), config::TRAY_RECENT_MAX);
    }

    #[test]
    fn empty_title_rows_are_dropped() {
        let s = snapshot(vec![notif("1", "", false), notif("2", "real", false)]);
        let v = build(&s);
        assert_eq!(v.unread.len(), 1);
        assert_eq!(v.unread[0].id, "2");
    }

    #[test]
    fn recording_present_maps_to_recording_view() {
        let s = TraySnapshot {
            unread_count: 0,
            notifs: Vec::new(),
            recording: Some("Standup".to_string()),
            version: "1.0.0".to_string(),
        };
        let v = build(&s);
        assert_eq!(v.recording, Some(RecordingView { title: "Standup".to_string() }));
    }

    #[test]
    fn recording_absent_is_none() {
        let s = TraySnapshot {
            unread_count: 0,
            notifs: Vec::new(),
            recording: None,
            version: "1.0.0".to_string(),
        };
        let v = build(&s);
        assert_eq!(v.recording, None);
    }

    #[test]
    fn title_is_none_at_zero_unread() {
        let v = build(&snapshot(Vec::new()));
        assert_eq!(title(&v), None);
    }

    #[test]
    fn title_is_count_string_at_three_unread() {
        let s = snapshot(vec![notif("1", "a", false), notif("2", "b", false), notif("3", "c", false)]);
        let v = build(&s);
        assert_eq!(title(&v), Some("3".to_string()));
    }

    #[test]
    fn tooltip_with_no_unread() {
        let v = build(&snapshot(Vec::new()));
        assert_eq!(tooltip(&v), "DALI OS");
    }

    #[test]
    fn tooltip_with_unread_and_no_urgent() {
        let s = snapshot(vec![notif("1", "a", false), notif("2", "b", false), notif("3", "c", false)]);
        let v = build(&s);
        assert_eq!(tooltip(&v), "3 unread");
    }

    #[test]
    fn tooltip_with_unread_and_urgent() {
        let s = snapshot(vec![notif("1", "a", false), notif("2", "b", false), notif("3", "c", true)]);
        let v = build(&s);
        assert_eq!(tooltip(&v), "3 unread, 1 urgent");
    }
}
