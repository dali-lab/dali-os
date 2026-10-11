// Pure tray/panel view-model. Takes a plain snapshot of app state (no
// AppHandle, so no Tauri runtime needed) and derives everything the tray
// icon (title/tooltip/menu) and the panel window render. Keeping this out of
// tray.rs makes the ordering/truncation/filtering rules unit-testable
// directly, without a running app.

use serde::Serialize;

use crate::config;
use crate::state::{AgendaNext, RecentNotif, TaskItem};

const TITLE_MAX_CHARS: usize = 44;
// Menubar real estate is scarce (MeetingBar and Notion Calendar cap around
// here too): short title, terse countdown.
const NEXT_TITLE_MAX_CHARS: usize = 18;
const TASKS_MAX: usize = 3;

pub struct TraySnapshot {
    pub unread_count: i64,
    pub notifs: Vec<RecentNotif>,
    pub recording: Option<RecordingSnap>,
    pub version: String,
    pub next: Option<AgendaNext>,
    pub now_unix: i64,
    pub tasks: Vec<TaskItem>,
    pub task_count: i64,
    pub connection: Connection,
    pub last_sync_secs: Option<u64>,
}

pub struct RecordingSnap {
    pub title: String,
    pub elapsed_secs: u64,
}

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Connection {
    Live,
    Polling,
    Offline,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrayView {
    pub unread_count: i64,
    pub unread: Vec<UnreadRow>,
    pub recording: Option<RecordingView>,
    pub version: String,
    pub next: Option<NextView>,
    pub tasks: Vec<TaskRow>,
    pub task_count: i64,
    pub connection: Connection,
    pub last_sync_secs: Option<u64>,
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
    pub elapsed_secs: u64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NextView {
    pub id: String,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub join_url: Option<String>,
    pub link: Option<String>,
    pub note_page_id: Option<String>,
    pub can_record: bool,
    // Negative once the meeting has started.
    pub minutes_until: i64,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskRow {
    pub id: String,
    pub title: String,
    pub link: Option<String>,
}

fn truncated(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let cut: String = s.chars().take(max_chars.saturating_sub(1)).collect();
    format!("{cut}…")
}

fn format_duration(total_secs: u64) -> String {
    let h = total_secs / 3600;
    let m = (total_secs % 3600) / 60;
    let s = total_secs % 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{m}:{s:02}")
    }
}

fn countdown_suffix(minutes_until: i64) -> String {
    if minutes_until <= 0 {
        "now".to_string()
    } else if minutes_until < 60 {
        format!("{minutes_until}m")
    } else {
        format!("{}h", minutes_until / 60)
    }
}

fn next_title_text(n: &NextView) -> String {
    format!("{} · {}", truncated(&n.title, NEXT_TITLE_MAX_CHARS), countdown_suffix(n.minutes_until))
}

fn build_next(next: &AgendaNext, now_unix: i64) -> Option<NextView> {
    let starts_unix = parse_iso8601_unix(&next.starts_at)?;
    let minutes_until = ((starts_unix - now_unix) as f64 / 60.0).round() as i64;
    Some(NextView {
        id: next.id.clone(),
        title: next.title.clone(),
        starts_at: next.starts_at.clone(),
        ends_at: next.ends_at.clone(),
        join_url: next.join_url.clone(),
        link: next.link.clone(),
        note_page_id: next.note_page_id.clone(),
        can_record: next.can_record,
        minutes_until,
    })
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
            title: truncated(&n.title, TITLE_MAX_CHARS),
            link: n.link.clone(),
            urgent: n.urgent,
        })
        .collect();

    let tasks = s
        .tasks
        .iter()
        .take(TASKS_MAX)
        .map(|t| TaskRow { id: t.id.clone(), title: t.title.clone(), link: t.link.clone() })
        .collect();

    TrayView {
        unread_count: s.unread_count,
        unread,
        recording: s.recording.as_ref().map(|r| RecordingView {
            title: r.title.clone(),
            elapsed_secs: r.elapsed_secs,
        }),
        version: s.version.clone(),
        next: s.next.as_ref().and_then(|n| build_next(n, s.now_unix)),
        tasks,
        task_count: s.task_count,
        connection: s.connection,
        last_sync_secs: s.last_sync_secs,
    }
}

/// Text beside the menubar icon: a live recording's clock, else the next
/// meeting, else nothing. Never the unread count — that's the panel's job.
pub fn title(v: &TrayView) -> Option<String> {
    if let Some(rec) = &v.recording {
        return Some(format!("● {}", format_duration(rec.elapsed_secs)));
    }
    v.next.as_ref().map(next_title_text)
}

pub fn tooltip(v: &TrayView) -> String {
    if let Some(rec) = &v.recording {
        return format!("Recording · {}", rec.title);
    }
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

/// Parses a UTC ISO-8601 timestamp (`Date.toISOString()` output, e.g.
/// `2026-10-09T14:30:00.000Z`) into Unix seconds. No date/time crate: the
/// format is fixed-width and always UTC, so a hand-rolled parser covers the
/// comparisons this needs (minute-scale, so sub-second precision is
/// irrelevant) without a new dependency. Shared by poller.rs (record-prompt
/// occurrence timing) and this module (agenda countdown).
pub(crate) fn parse_iso8601_unix(s: &str) -> Option<i64> {
    if s.len() < 19 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;
    let hour: i64 = s.get(11..13)?.parse().ok()?;
    let minute: i64 = s.get(14..16)?.parse().ok()?;
    let second: i64 = s.get(17..19)?.parse().ok()?;

    // Everything after the whole seconds is optional fractional seconds
    // and/or a timezone offset; default to UTC if neither is present.
    let rest = &s[19..];
    let offset_minutes: i64 = if rest.contains(['Z', 'z']) {
        0
    } else if let Some(pos) = rest.find(['+', '-']) {
        let sign = if rest.as_bytes()[pos] == b'-' { -1 } else { 1 };
        let off = &rest[pos + 1..];
        let oh: i64 = off.get(0..2)?.parse().ok()?;
        let om: i64 = off.get(3..5).and_then(|m| m.parse().ok()).unwrap_or(0);
        sign * (oh * 60 + om)
    } else {
        0
    };

    let days = days_from_civil(year, month, day);
    Some(days * 86_400 + hour * 3_600 + minute * 60 + second - offset_minutes * 60)
}

/// Howard Hinnant's days-from-civil algorithm (proleptic Gregorian days
/// since the Unix epoch).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
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
            next: None,
            now_unix: 0,
            tasks: Vec::new(),
            task_count: 0,
            connection: Connection::Live,
            last_sync_secs: None,
        }
    }

    fn empty_snapshot() -> TraySnapshot {
        snapshot(Vec::new())
    }

    fn agenda(starts_at: &str) -> AgendaNext {
        AgendaNext {
            id: "m1".to_string(),
            title: "Standup".to_string(),
            starts_at: starts_at.to_string(),
            ends_at: "2026-10-10T15:00:00.000Z".to_string(),
            join_url: Some("https://zoom.us/j/123".to_string()),
            link: Some("/calendar/meeting/m1".to_string()),
            note_page_id: Some("p1".to_string()),
            can_record: true,
        }
    }

    #[test]
    fn empty_snapshot_builds_empty_view() {
        let v = build(&empty_snapshot());
        assert_eq!(v.unread_count, 0);
        assert!(v.unread.is_empty());
        assert_eq!(v.recording, None);
        assert_eq!(v.version, "1.2.3");
        assert_eq!(v.next, None);
        assert!(v.tasks.is_empty());
        assert_eq!(v.task_count, 0);
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
        let mut s = empty_snapshot();
        s.recording = Some(RecordingSnap { title: "Standup".to_string(), elapsed_secs: 65 });
        let v = build(&s);
        assert_eq!(v.recording, Some(RecordingView { title: "Standup".to_string(), elapsed_secs: 65 }));
    }

    #[test]
    fn recording_absent_is_none() {
        let v = build(&empty_snapshot());
        assert_eq!(v.recording, None);
    }

    // ── Title / tooltip ──────────────────────────────────────────────────

    #[test]
    fn title_is_none_with_nothing_upcoming_even_with_unread() {
        let s = snapshot(vec![notif("1", "a", false), notif("2", "b", false)]);
        assert_eq!(title(&build(&s)), None);
    }

    #[test]
    fn title_with_next_shows_compact_countdown() {
        let mut s = empty_snapshot();
        s.now_unix = 1_000_000_000;
        s.next = Some(agenda("2026-10-10T14:00:00.000Z"));
        // 1_000_000_000 is itself a valid unix timestamp; pick a starts_at
        // 12 minutes later in unix time via now_unix/starts_at pairing below.
        let starts_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap();
        s.now_unix = starts_unix - 12 * 60;
        let v = build(&s);
        assert_eq!(title(&v), Some("Standup · 12m".to_string()));
        s.now_unix = starts_unix - 125 * 60;
        assert_eq!(title(&build(&s)), Some("Standup · 2h".to_string()));
        s.now_unix = starts_unix + 60;
        assert_eq!(title(&build(&s)), Some("Standup · now".to_string()));
    }

    #[test]
    fn title_caps_long_meeting_names_at_18_chars() {
        let mut s = empty_snapshot();
        let mut a = agenda("2026-10-10T14:00:00.000Z");
        a.title = "Application Help Hours with Partners".to_string();
        s.next = Some(a);
        s.now_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap() - 5 * 60;
        assert_eq!(title(&build(&s)), Some("Application Help … · 5m".to_string()));
    }

    #[test]
    fn recording_title_overrides_next_meeting() {
        let mut s = snapshot(vec![notif("1", "a", false)]);
        s.next = Some(agenda("2026-10-10T14:00:00.000Z"));
        s.recording = Some(RecordingSnap { title: "Standup".to_string(), elapsed_secs: 5 });
        assert_eq!(title(&build(&s)), Some("● 0:05".to_string()));
    }

    #[test]
    fn recording_title_format_seconds_only() {
        let mut s = empty_snapshot();
        s.recording = Some(RecordingSnap { title: "x".to_string(), elapsed_secs: 5 });
        assert_eq!(title(&build(&s)), Some("● 0:05".to_string()));
    }

    #[test]
    fn recording_title_format_minutes_seconds() {
        let mut s = empty_snapshot();
        s.recording = Some(RecordingSnap { title: "x".to_string(), elapsed_secs: 754 });
        assert_eq!(title(&build(&s)), Some("● 12:34".to_string()));
    }

    #[test]
    fn recording_title_format_hours_minutes_seconds() {
        let mut s = empty_snapshot();
        s.recording = Some(RecordingSnap { title: "x".to_string(), elapsed_secs: 3723 });
        assert_eq!(title(&build(&s)), Some("● 1:02:03".to_string()));
    }

    #[test]
    fn recording_tooltip_shows_title() {
        let mut s = empty_snapshot();
        s.recording = Some(RecordingSnap { title: "Standup".to_string(), elapsed_secs: 5 });
        assert_eq!(tooltip(&build(&s)), "Recording · Standup");
    }

    #[test]
    fn tooltip_with_no_unread() {
        let v = build(&empty_snapshot());
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

    // ── Up next / countdown ──────────────────────────────────────────────

    #[test]
    fn next_countdown_at_12_minutes() {
        let starts_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap();
        let mut s = empty_snapshot();
        s.next = Some(agenda("2026-10-10T14:00:00.000Z"));
        s.now_unix = starts_unix - 12 * 60;
        let v = build(&s);
        assert_eq!(v.next.unwrap().minutes_until, 12);
    }

    #[test]
    fn next_countdown_at_2_hours_rounds_down_to_whole_hours_in_title() {
        let mut s = empty_snapshot();
        let starts_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap();
        s.next = Some(agenda("2026-10-10T14:00:00.000Z"));
        s.now_unix = starts_unix - 125 * 60;
        let v = build(&s);
        assert_eq!(v.next.as_ref().unwrap().minutes_until, 125);
        assert_eq!(title(&v), Some("Standup · 2h".to_string()));
    }

    #[test]
    fn next_countdown_started_is_now() {
        let mut s = empty_snapshot();
        let starts_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap();
        s.next = Some(agenda("2026-10-10T14:00:00.000Z"));
        s.now_unix = starts_unix + 5 * 60;
        let v = build(&s);
        assert_eq!(v.next.as_ref().unwrap().minutes_until, -5);
        assert_eq!(title(&v), Some("Standup · now".to_string()));
    }

    #[test]
    fn next_title_truncated_at_18_chars() {
        let mut s = empty_snapshot();
        let mut a = agenda("2026-10-10T14:00:00.000Z");
        a.title = "a".repeat(30);
        s.next = Some(a);
        let starts_unix = parse_iso8601_unix("2026-10-10T14:00:00.000Z").unwrap();
        s.now_unix = starts_unix - 5 * 60;
        let v = build(&s);
        let expected = format!("{} · 5m", format!("{}…", "a".repeat(17)));
        assert_eq!(title(&v), Some(expected));
    }

    #[test]
    fn next_with_unparseable_start_is_dropped() {
        let mut s = empty_snapshot();
        let mut a = agenda("not-a-date");
        a.title = "Standup".to_string();
        s.next = Some(a);
        let v = build(&s);
        assert_eq!(v.next, None);
    }

    // ── Tasks ────────────────────────────────────────────────────────────

    fn task(id: &str) -> TaskItem {
        TaskItem { id: id.to_string(), title: format!("Task {id}"), link: Some(format!("/tasks/{id}")) }
    }

    #[test]
    fn tasks_cap_at_three() {
        let mut s = empty_snapshot();
        s.tasks = (0..5).map(|i| task(&i.to_string())).collect();
        s.task_count = 5;
        let v = build(&s);
        assert_eq!(v.tasks.len(), 3);
        assert_eq!(v.task_count, 5);
    }

    #[test]
    fn tasks_below_cap_are_unchanged() {
        let mut s = empty_snapshot();
        s.tasks = vec![task("1")];
        s.task_count = 1;
        let v = build(&s);
        assert_eq!(v.tasks.len(), 1);
    }

    // ── Connection ───────────────────────────────────────────────────────

    #[test]
    fn connection_serializes_to_spec_strings() {
        assert_eq!(serde_json::to_string(&Connection::Live).unwrap(), "\"live\"");
        assert_eq!(serde_json::to_string(&Connection::Polling).unwrap(), "\"polling\"");
        assert_eq!(serde_json::to_string(&Connection::Offline).unwrap(), "\"offline\"");
    }

    #[test]
    fn connection_and_last_sync_pass_through_build() {
        let mut s = empty_snapshot();
        s.connection = Connection::Offline;
        s.last_sync_secs = Some(42);
        let v = build(&s);
        assert_eq!(v.connection, Connection::Offline);
        assert_eq!(v.last_sync_secs, Some(42));
    }

    // ── ISO-8601 parsing ─────────────────────────────────────────────────

    #[test]
    fn parses_basic_utc_timestamp() {
        assert_eq!(parse_iso8601_unix("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso8601_unix("2024-01-01T00:00:00.000Z"), Some(1_704_067_200));
    }

    #[test]
    fn parses_timestamp_without_fractional_seconds() {
        assert_eq!(parse_iso8601_unix("1970-01-01T00:00:01Z"), Some(1));
    }

    #[test]
    fn parses_timestamp_with_positive_offset() {
        // 14:30+02:00 is 12:30 UTC.
        assert_eq!(
            parse_iso8601_unix("1970-01-01T14:30:00+02:00"),
            parse_iso8601_unix("1970-01-01T12:30:00Z"),
        );
    }

    #[test]
    fn parses_timestamp_with_negative_offset() {
        assert_eq!(
            parse_iso8601_unix("1970-01-01T08:00:00-05:00"),
            parse_iso8601_unix("1970-01-01T13:00:00Z"),
        );
    }

    #[test]
    fn rejects_too_short_or_malformed_timestamps() {
        assert_eq!(parse_iso8601_unix("short"), None);
        assert_eq!(parse_iso8601_unix("2026-10-10T14:00:0X.000Z"), None);
    }
}
