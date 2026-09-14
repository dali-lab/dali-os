// DALI → JobX Timesheet Filler — background service worker.
//
// Every request to DALI OS goes through here rather than the content script.
// A content script's fetch runs as the JobX page: it's cross-site to DALI, so
// Chrome drops the SameSite=Lax __dali_sid cookie and DALI answers 401 no
// matter whether the member is signed in. A request from the extension's own
// origin to a host it holds host_permissions for is treated as same-site, so
// the cookie rides along (and CORS doesn't apply).

const DEFAULT_BASE = "https://os.dali.dartmouth.edu";
const EXPORT_PARAMS = ["hire", "period"];

async function daliBase() {
  const { daliBase } = await chrome.storage.sync.get("daliBase");
  return (daliBase || DEFAULT_BASE).replace(/\/$/, "");
}

async function fetchExport(params) {
  const base = await daliBase();
  const qs = new URLSearchParams();
  for (const key of EXPORT_PARAMS) {
    if (params && params[key]) qs.set(key, params[key]);
  }
  const url = `${base}/api/timesheets/export${qs.size ? `?${qs}` : ""}`;
  let res;
  try {
    res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  } catch {
    return { ok: false, base, error: `Couldn't reach DALI OS at ${base}.` };
  }
  if (res.status === 401) {
    return { ok: false, base, signedOut: true, error: "You're not signed in to DALI OS." };
  }
  if (!res.ok) return { ok: false, base, error: `DALI OS returned an error (${res.status}).` };
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, base, error: "DALI OS sent a response the extension couldn't read." };
  }
  // A server still on the pre-pay-period export (no `periods`) answers 200
  // with a shape the panel can't render; say so rather than crash on it.
  if (!data || !Array.isArray(data.availableHires) || !Array.isArray(data.periods)) {
    return {
      ok: false,
      base,
      error: `${new URL(base).host} is running an older DALI OS without pay-period support. Update the server, or pick another in the extension's popup.`,
    };
  }
  return { ok: true, base, data };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "dali:export") return false;
  fetchExport(msg.params).then(sendResponse);
  return true; // keep the channel open for the async response
});
