// Tray panel controller. Rust pushes the current view over `tray://state`
// on every open (window.rs's toggle_tray_panel) and after every delivery
// sync (tray.rs's refresh); `tray_get_view` is also pulled once on load in
// case the panel was built earlier and missed that push. Every render
// re-measures the card and asks Rust to resize the window to fit
// (window.rs's set_tray_panel_height clamps to [120, 640]).

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = (id) => document.getElementById(id);

function renderRecording(view) {
  const section = el("recording");
  if (view.recording) {
    section.classList.remove("hidden");
    el("rec-title").textContent = view.recording.title;
  } else {
    section.classList.add("hidden");
  }
}

function renderHeader(view) {
  const count = view.unreadCount;
  el("unread-label").textContent = count > 0 ? `${count} unread` : "Notifications";
  el("btn-mark-all").classList.toggle("hidden", count <= 0);
}

function renderRows(view) {
  const rows = el("rows");
  rows.innerHTML = "";
  for (const row of view.unread) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = row.urgent ? "row urgent" : "row";

    const dot = document.createElement("span");
    dot.className = row.urgent ? "dot urgent" : "dot";
    button.appendChild(dot);

    const title = document.createElement("span");
    title.className = "row-title";
    title.textContent = row.title;
    button.appendChild(title);

    if (row.urgent) {
      const now = document.createElement("span");
      now.className = "row-now";
      now.textContent = "now";
      button.appendChild(now);
    }

    button.addEventListener("click", () => invoke("tray_open_link", { id: row.id }));
    rows.appendChild(button);
  }
  el("empty").classList.toggle("hidden", view.unread.length > 0);
}

function renderFooter(view) {
  el("version").textContent = `v${view.version}`;
}

function resizeToContent() {
  invoke("tray_panel_set_height", { height: document.body.scrollHeight });
}

function render(view) {
  renderRecording(view);
  renderHeader(view);
  renderRows(view);
  renderFooter(view);
  resizeToContent();
}

listen("tray://state", (event) => {
  if (event.payload) render(event.payload);
});

invoke("tray_get_view").then((view) => {
  if (view) render(view);
});

el("btn-stop").addEventListener("click", () => invoke("tray_stop_recording"));
el("btn-mark-all").addEventListener("click", () => invoke("tray_mark_all_read"));
el("btn-open").addEventListener("click", () => invoke("tray_open_app"));
el("btn-settings").addEventListener("click", () => invoke("tray_open_settings"));
el("btn-quit").addEventListener("click", () => invoke("tray_quit"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") invoke("tray_panel_hide");
});
