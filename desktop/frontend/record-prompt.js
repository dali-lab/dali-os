// Floating "Meeting detected" window controller. Rust pushes each prompt's
// content over `record-prompt://show` (window.rs / notify.rs); every button
// here just invokes one of the record_prompt_* commands (commands.rs) keyed
// by that prompt's notification id and lets Rust hide the window.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = (id) => document.getElementById(id);

let current = null; // the payload from the latest `record-prompt://show`

// Mirrors the server's notification-copy.ts subject template
// ("{{itemTitle}} is starting. Record it?") so the window can show just the
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

function openMenu() {
  el("menu").classList.remove("hidden");
  el("btn-chevron").setAttribute("aria-expanded", "true");
}

function closeMenu() {
  el("menu").classList.add("hidden");
  el("btn-chevron").setAttribute("aria-expanded", "false");
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
el("btn-chevron").addEventListener("click", () => {
  if (el("menu").classList.contains("hidden")) openMenu();
  else closeMenu();
});
el("menu-back").addEventListener("click", closeMenu);
el("menu-open").addEventListener("click", () => {
  if (current) invoke("record_prompt_open", { id: current.id });
});
el("menu-mute").addEventListener("click", () => {
  if (current) invoke("record_prompt_mute", { id: current.id });
});
