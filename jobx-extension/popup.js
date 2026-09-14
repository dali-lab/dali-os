const serverEl = document.getElementById("server");
const customEl = document.getElementById("custom");
const savedEl = document.getElementById("saved");
const dotEl = document.getElementById("dot");
const titleEl = document.getElementById("status-title");
const detailEl = document.getElementById("status-detail");
const signinEl = document.getElementById("signin");

const presets = Array.from(serverEl.options).map((o) => o.value).filter((v) => v !== "custom");

function setStatus(kind, title, detail) {
  dotEl.className = "dot" + (kind ? ` ${kind}` : "");
  titleEl.textContent = title;
  detailEl.textContent = detail || "";
}

async function checkConnection() {
  setStatus("", "Checking DALI OS…");
  signinEl.hidden = true;
  const res = await chrome.runtime.sendMessage({ type: "dali:export" });
  const host = res && res.base ? new URL(res.base).host : "";
  if (res && res.ok) {
    const n = res.data.availableHires.length;
    setStatus("ok", "Connected", `${n} role${n === 1 ? "" : "s"} on ${host}`);
  } else if (res && res.signedOut) {
    setStatus("warn", "Not signed in", `Sign in to ${host} in this browser.`);
    signinEl.href = res.base;
    signinEl.hidden = false;
  } else {
    setStatus("warn", "Can't use this server", res ? res.error : "The extension didn't respond.");
  }
}

async function save(daliBase) {
  await chrome.storage.sync.set({ daliBase });
  savedEl.textContent = "Saved";
  setTimeout(() => { savedEl.textContent = ""; }, 1500);
  checkConnection();
}

serverEl.addEventListener("change", () => {
  const custom = serverEl.value === "custom";
  customEl.hidden = !custom;
  if (custom) customEl.focus();
  else save(serverEl.value);
});

customEl.addEventListener("change", () => {
  const value = customEl.value.trim().replace(/\/$/, "");
  if (value) save(value);
});

chrome.storage.sync.get("daliBase").then(({ daliBase }) => {
  const base = daliBase || presets[0];
  if (presets.includes(base)) {
    serverEl.value = base;
  } else {
    serverEl.value = "custom";
    customEl.hidden = false;
    customEl.value = base;
    document.getElementById("advanced").open = true;
  }
  checkConnection();
});
