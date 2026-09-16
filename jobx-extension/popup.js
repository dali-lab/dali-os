const dotEl = document.getElementById("dot");
const titleEl = document.getElementById("status-title");
const detailEl = document.getElementById("status-detail");
const signinEl = document.getElementById("signin");

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
    setStatus("warn", "Can't reach DALI OS", res ? res.error : "The extension didn't respond.");
  }
}

checkConnection();
