// Floating record-prompt pill controller. Rust pushes each prompt's content
// over `record-prompt://show` (window.rs / notify.rs); every button here
// invokes one of the record_prompt_* commands (commands.rs) keyed by that
// prompt's notification id and lets Rust hide the window. The chevron menu
// hangs below the pill, so opening it also asks Rust to grow the frame.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = (id) => document.getElementById(id);

let current = null; // the payload from the latest `record-prompt://show`

// Mirrors the server's notification-copy.ts subject template
// ("{{itemTitle}} is starting. Record it?") so the pill can show just the
// meeting name. Falls back to the raw title if that copy ever changes.
const TITLE_SUFFIX = " is starting. Record it?";
function meetingTitle(rawTitle) {
  if (!rawTitle) return "";
  return rawTitle.endsWith(TITLE_SUFFIX) ? rawTitle.slice(0, -TITLE_SUFFIX.length) : rawTitle;
}

function render(prompt) {
  const title = meetingTitle(prompt.title);
  const subtitle =
    title && prompt.source
      ? `${title} · ${prompt.source}`
      : title || prompt.source || "This meeting";
  el("subtitle").textContent = subtitle;
  closeMenu();
}

function menuOpen() {
  return !el("menu").classList.contains("hidden");
}

function openMenu() {
  invoke("record_prompt_set_expanded", { expanded: true });
  el("menu").classList.remove("hidden");
  el("btn-chevron").setAttribute("aria-expanded", "true");
}

function closeMenu() {
  if (!menuOpen()) return;
  el("menu").classList.add("hidden");
  el("btn-chevron").setAttribute("aria-expanded", "false");
  invoke("record_prompt_set_expanded", { expanded: false });
}

listen("record-prompt://show", (event) => {
  current = event.payload ?? null;
  if (current) render(current);
});

el("btn-start").addEventListener("click", () => {
  if (current) invoke("record_prompt_start", { id: current.id });
});
el("btn-close").addEventListener("click", () => {
  if (current) invoke("record_prompt_dismiss", { id: current.id });
});
el("btn-chevron").addEventListener("click", (e) => {
  e.stopPropagation();
  if (menuOpen()) closeMenu();
  else openMenu();
});
el("menu-open").addEventListener("click", () => {
  if (current) invoke("record_prompt_open", { id: current.id });
});
el("menu-mute").addEventListener("click", () => {
  if (current) invoke("record_prompt_mute", { id: current.id });
});
el("menu-dismiss").addEventListener("click", () => {
  if (current) invoke("record_prompt_dismiss", { id: current.id });
});

// Click anywhere outside the menu (or Escape) closes it, same as a native
// dropdown. The window never takes focus on raise, so Escape only applies
// once the user has clicked into it.
document.addEventListener("click", (e) => {
  if (menuOpen() && !el("menu").contains(e.target)) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenu();
});
