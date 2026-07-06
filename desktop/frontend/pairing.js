// Pairing window controller. Talks to the Rust shell over IPC (app commands)
// and listens for `pairing://state` events the shell emits as the device-flow
// progresses. No network calls happen here — all HTTP (start/poll) is done in
// Rust so the high-entropy deviceCode and the keychain token never touch JS.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const el = (id) => document.getElementById(id);
const views = {
  idle: el("view-idle"),
  pairing: el("view-pairing"),
  message: el("view-message"),
};

let verificationUrl = null;

function show(view) {
  for (const [name, node] of Object.entries(views)) {
    node.classList.toggle("hidden", name !== view);
  }
}

function setMessage(text, { canRetry = true } = {}) {
  el("message-text").textContent = text;
  el("btn-retry").classList.toggle("hidden", !canRetry);
  show("message");
}

async function startPairing() {
  try {
    show("pairing");
    el("user-code").textContent = "––––-––––";
    await invoke("pairing_start");
  } catch (err) {
    setMessage(`Couldn't start sign-in: ${err}`);
  }
}

// State pushed from Rust as the flow advances.
listen("pairing://state", (event) => {
  const s = event.payload ?? {};
  switch (s.status) {
    case "starting":
      show("pairing");
      el("user-code").textContent = "––––-––––";
      break;
    case "awaiting_approval":
      show("pairing");
      if (s.userCode) el("user-code").textContent = s.userCode;
      verificationUrl = s.verificationUrl ?? null;
      break;
    case "planting":
      el("title").textContent = "Almost there…";
      break;
    case "paired":
      // The shell hides this window and shows the app; nothing more to do.
      break;
    case "expired":
      setMessage("This pairing request expired. Try again to get a fresh code.");
      break;
    case "error":
      setMessage(s.message ? `Sign-in failed: ${s.message}` : "Sign-in failed.");
      break;
    default:
      break;
  }
});

el("btn-signin").addEventListener("click", startPairing);
el("btn-retry").addEventListener("click", () => {
  el("title").textContent = "Sign in to DALI OS";
  startPairing();
});
el("btn-cancel").addEventListener("click", async () => {
  try {
    await invoke("pairing_cancel");
  } catch {
    /* ignore */
  }
  el("title").textContent = "Sign in to DALI OS";
  show("idle");
});
el("reopen").addEventListener("click", async (e) => {
  e.preventDefault();
  if (verificationUrl) await invoke("open_external", { url: verificationUrl });
});

// On load, reflect the current auth state (first run → idle).
(async () => {
  try {
    const state = await invoke("get_auth_state");
    if (state === "Pairing") show("pairing");
    else show("idle");
  } catch {
    show("idle");
  }
})();
