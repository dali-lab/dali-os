// Tray panel controller. Rust pushes the current view over `tray://state`
// on every open (window.rs's toggle_tray_panel) and after every delivery
// sync or ticker (tray.rs's refresh); `tray_get_view` is also pulled once on
// load in case the panel was built earlier and missed that push. Every
// render re-measures the card and asks Rust to resize the window to fit
// (window.rs's set_tray_panel_height clamps to [120, 640]).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = (id) => document.getElementById(id);
let lastView = null;
let lastViewAt = 0;

function clock(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function renderRecording(view) {
  const section = el("recording");
  if (view.recording) {
    section.classList.remove("hidden");
    el("rec-clock").textContent = clock(view.recording.elapsedSecs);
    el("rec-title").textContent = view.recording.title || "Recording";
  } else {
    section.classList.add("hidden");
  }
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

function relative(minutes) {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `in ${h} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
}

function renderNext(view) {
  const section = el("next");
  const next = view.next;
  if (!next) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  el("next-title").textContent = next.title;
  const start = new Date(next.startsAt);
  const time = isNaN(start) ? "" : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(start);
  el("next-when").textContent = `${time} · ${relative(next.minutesUntil)}`;
  const kind = callKind(next.joinUrl);
  el("next-kind").textContent = kind ?? "";
  el("next-kind").classList.toggle("hidden", !kind);
  el("btn-join").classList.toggle("hidden", !next.joinUrl);
  el("btn-notes").classList.toggle("hidden", !next.notePageId);
  el("btn-record").classList.toggle("hidden", !(next.canRecord && !view.recording));
}

function renderHeader(view) {
  const count = view.unreadCount;
  el("unread-label").textContent = count > 0 ? `${count} unread` : "Notifications";
  el("btn-mark-all").classList.toggle("hidden", count <= 0);
}

function rowButton({ lead, title, trailing, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row";
  button.appendChild(lead);
  const t = document.createElement("span");
  t.className = "row-title";
  t.textContent = title;
  button.appendChild(t);
  if (trailing) {
    const tr = document.createElement("span");
    tr.className = "row-now";
    tr.textContent = trailing;
    button.appendChild(tr);
  }
  button.addEventListener("click", onClick);
  return button;
}

function renderRows(view) {
  const rows = el("rows");
  rows.innerHTML = "";
  for (const row of view.unread) {
    const dot = document.createElement("span");
    dot.className = row.urgent ? "dot urgent" : "dot";
    rows.appendChild(
      rowButton({
        lead: dot,
        title: row.title,
        trailing: row.urgent ? "now" : null,
        onClick: () => invoke("tray_open_link", { id: row.id }),
      }),
    );
  }
  el("empty").classList.toggle("hidden", view.unread.length > 0);
}

function renderTasks(view) {
  const section = el("todo");
  if (!view.taskCount) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  el("todo-label").textContent = `${view.taskCount} to do`;
  const rows = el("task-rows");
  rows.innerHTML = "";
  for (const task of view.tasks) {
    const box = document.createElement("span");
    box.className = "box";
    rows.appendChild(
      rowButton({
        lead: box,
        title: task.title,
        onClick: () => invoke("tray_open_path", { path: task.link || "/notifications" }),
      }),
    );
  }
}

function renderStatus() {
  if (!lastView) return;
  const drift = Math.floor((Date.now() - lastViewAt) / 1000);
  const secs = lastView.lastSyncSecs == null ? null : lastView.lastSyncSecs + drift;
  const ago = secs == null ? "" : secs < 60 ? ` · ${secs}s ago` : ` · ${Math.floor(secs / 60)}m ago`;
  const label = { live: "Live", polling: "Polling", offline: "Offline" }[lastView.connection] ?? "";
  el("conn-text").textContent = lastView.connection === "offline" ? label : label + ago;
  el("conn-dot").className = `conn-dot ${lastView.connection}`;
}

function renderFooter(view) {
  el("version").textContent = `v${view.version}`;
  renderStatus();
}

function resizeToContent() {
  invoke("tray_panel_set_height", { height: document.body.scrollHeight });
}

function render(view) {
  lastView = view;
  lastViewAt = Date.now();
  renderRecording(view);
  renderNext(view);
  renderHeader(view);
  renderRows(view);
  renderTasks(view);
  renderFooter(view);
  resizeToContent();
}

listen("tray://state", (event) => {
  if (event.payload) render(event.payload);
});

invoke("tray_get_view").then((view) => {
  if (view) render(view);
});

setInterval(renderStatus, 15000);

el("btn-stop").addEventListener("click", () => invoke("tray_stop_recording"));
el("btn-mark-all").addEventListener("click", () => invoke("tray_mark_all_read"));
el("btn-open").addEventListener("click", () => invoke("tray_open_app"));
el("btn-settings").addEventListener("click", () => invoke("tray_open_settings"));
el("btn-quit").addEventListener("click", () => invoke("tray_quit"));
el("btn-calendar").addEventListener("click", () => invoke("tray_open_path", { path: "/calendar" }));
el("btn-all-tasks").addEventListener("click", () => invoke("tray_open_path", { path: "/notifications" }));
el("btn-join").addEventListener("click", () => {
  if (lastView?.next?.joinUrl) invoke("tray_open_external", { url: lastView.next.joinUrl });
});
el("btn-notes").addEventListener("click", () => {
  if (lastView?.next?.notePageId) invoke("tray_open_path", { path: `/documents/${lastView.next.notePageId}` });
});
el("btn-record").addEventListener("click", () => invoke("tray_record_next"));

const newMenu = el("new-menu");
const btnNew = el("btn-new");
function setNewMenu(open) {
  newMenu.classList.toggle("hidden", !open);
  btnNew.setAttribute("aria-expanded", String(open));
}
btnNew.addEventListener("click", (e) => {
  e.stopPropagation();
  setNewMenu(newMenu.classList.contains("hidden"));
});
for (const item of newMenu.querySelectorAll("[data-path]")) {
  item.addEventListener("click", () => {
    setNewMenu(false);
    invoke("tray_open_path", { path: item.dataset.path });
  });
}
document.addEventListener("click", (e) => {
  if (!newMenu.contains(e.target)) setNewMenu(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!newMenu.classList.contains("hidden")) setNewMenu(false);
  else invoke("tray_panel_hide");
});
