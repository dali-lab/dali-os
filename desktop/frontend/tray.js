// Tray panel controller. Rust pushes the current view over `tray://state`
// on every open (window.rs's toggle_tray_panel) and after every delivery
// sync or ticker (tray.rs's refresh); `tray_get_view` is also pulled once on
// load in case the panel was built earlier and missed that push. Every
// render re-measures the card and asks Rust to resize the window to fit
// (window.rs's set_tray_panel_height clamps to [120, 640]).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const el = (id) => document.getElementById(id);
const openPath = (path) => invoke("tray_open_path", { path });
let lastView = null;
let primaryAction = null;
let titleAction = null;

function clock(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function callKind(url) {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.includes("zoom.")) return "Zoom";
    if (host.includes("meet.google")) return "Meet";
    if (host.includes("teams.")) return "Teams";
    return "Call";
  } catch {
    return "Call";
  }
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function daysFromToday(date) {
  return Math.round((startOfDay(date) - startOfDay(new Date())) / MS_PER_DAY);
}

function time(date) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function timeNoPeriod(date) {
  return time(date).replace(/\s*[AP]M$/i, "");
}

function timeRange(start, end) {
  const samePeriod = (start.getHours() < 12) === (end.getHours() < 12);
  return `${samePeriod ? timeNoPeriod(start) : time(start)} to ${time(end)}`;
}

function dayName(date) {
  if (daysFromToday(date) === 1) return "tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function relative(minutes) {
  if (minutes < 60) return `In ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `In ${h} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

function minutesLeft(endsAt) {
  return Math.max(Math.ceil((new Date(endsAt) - Date.now()) / 60000), 1);
}

function setNow({ label, labelClass = "", title, sub, onTitle = null }) {
  el("now-label").textContent = label;
  el("now-label").className = `now-label ${labelClass}`;
  el("now-open").textContent = title;
  el("now-open").disabled = !onTitle;
  titleAction = onTitle;
  el("now-sub").textContent = sub;
}

function setActions({ primary = null, stop = false, record = false, notes = false, call = null, onCall = false }) {
  const button = el("btn-primary");
  button.classList.toggle("hidden", !primary);
  button.classList.toggle("stop", stop);
  button.textContent = primary?.label ?? "";
  primaryAction = primary?.run ?? null;
  el("btn-record").classList.toggle("hidden", !record);
  el("btn-notes").classList.toggle("hidden", !notes);
  el("now-actions").classList.toggle("hidden", !primary && !record && !notes);
  el("now-call").classList.toggle("hidden", !call);
  el("now-call").textContent = call ?? "";
  el("now-call").disabled = !onCall;
}

function renderRecording(view) {
  const { next, recording } = view;
  setNow({
    label: `Recording · ${clock(recording.elapsedSecs)}`,
    labelClass: "recording",
    title: recording.title || "Recording",
    sub: "Notes fill in when you stop",
  });
  setActions({
    primary: { label: "Stop", run: () => invoke("tray_stop_recording") },
    stop: true,
    notes: Boolean(next?.notePageId) && next.title === recording.title,
  });
}

function renderMeeting(next) {
  const started = next.minutesUntil <= 0;
  const kind = callKind(next.joinUrl);
  const openNotes = next.notePageId ? () => openPath(`/documents/${next.notePageId}`) : null;
  const openMeeting = next.link ? () => openPath(next.link) : null;
  const join = { label: "Join", run: () => invoke("tray_open_external", { url: next.joinUrl }) };
  const notes = { label: "Open notes", run: openNotes };

  setNow({
    label: started ? `${minutesLeft(next.endsAt)} min left` : relative(next.minutesUntil),
    title: next.title,
    sub: started
      ? `Until ${time(new Date(next.endsAt))}`
      : timeRange(new Date(next.startsAt), new Date(next.endsAt)),
    onTitle: openNotes ?? openMeeting,
  });

  // Mid-meeting the notes matter most, but someone running late still needs
  // the call, so the provider name stays a Join link whenever the main button
  // isn't Join.
  const preferred = started ? [openNotes && notes, next.joinUrl && join] : [next.joinUrl && join, openNotes && notes];
  const primary = preferred.find(Boolean) ?? null;
  const callIsLink = Boolean(kind) && primary !== join;

  setActions({
    primary,
    record: next.canRecord,
    call: kind && `· ${callIsLink ? "Join " : ""}${kind}`,
    onCall: callIsLink,
  });
}

function renderFree(following) {
  const start = following && new Date(following.startsAt);
  setNow({
    label: "Nothing left today",
    labelClass: "quiet",
    title: following ? `Free until ${dayName(start)}` : "Nothing scheduled",
    sub: following ? `${following.title} at ${time(start)}` : "No meetings in the next two days",
    onTitle: following?.link ? () => openPath(following.link) : null,
  });
  setActions({});
}

function renderLater(rows) {
  const section = el("later");
  section.innerHTML = "";
  section.classList.toggle("hidden", rows.length === 0);
  for (const row of rows) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "row";
    const when = document.createElement("span");
    when.className = "row-time";
    when.textContent = timeNoPeriod(new Date(row.startsAt));
    const title = document.createElement("span");
    title.className = "row-title";
    title.textContent = row.title;
    button.append(when, title);
    button.addEventListener("click", () => openPath(row.link || "/calendar"));
    section.appendChild(button);
  }
}

function renderFooter(view) {
  const count = view.unreadCount;
  const badge = el("badge");
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count <= 0);
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  el("btn-notifications").title = label;
  el("btn-notifications").setAttribute("aria-label", label);
  el("offline").classList.toggle("hidden", view.connection !== "offline");
}

function resizeToContent() {
  invoke("tray_panel_set_height", { height: document.body.scrollHeight });
}

function render(view) {
  lastView = view;
  const next = view.next;
  const today = view.upcoming.filter((m) => daysFromToday(new Date(m.startsAt)) === 0);
  const nextIsToday = next && (next.minutesUntil <= 0 || daysFromToday(new Date(next.startsAt)) === 0);

  if (view.recording) renderRecording(view);
  else if (nextIsToday) renderMeeting(next);
  else renderFree(next ?? view.upcoming[0]);

  renderLater(view.recording || nextIsToday ? today : []);
  renderFooter(view);
  resizeToContent();
}

listen("tray://state", (event) => {
  if (event.payload) render(event.payload);
});

invoke("tray_get_view").then((view) => {
  if (view) render(view);
});

el("now-open").addEventListener("click", () => titleAction?.());
el("now-call").addEventListener("click", () => {
  if (lastView?.next?.joinUrl) invoke("tray_open_external", { url: lastView.next.joinUrl });
});
el("btn-primary").addEventListener("click", () => primaryAction?.());
el("btn-record").addEventListener("click", () => invoke("tray_record_next"));
el("btn-notes").addEventListener("click", () => {
  if (lastView?.next?.notePageId) openPath(`/documents/${lastView.next.notePageId}`);
});
el("btn-open").addEventListener("click", () => invoke("tray_open_app"));
el("btn-notifications").addEventListener("click", () => openPath("/notifications"));
el("btn-settings").addEventListener("click", () => invoke("tray_open_settings"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") invoke("tray_panel_hide");
});
