// DALI → JobX Timesheet Filler — content script.
//
// Runs on the JobX "Manage Time Sheet" page. Injects a "Fill from DALI"
// launcher; clicking it opens a panel where the member picks one of their
// paid roles and one of that role's pay periods, reviews the entries, and
// starts the fill. Data comes from DALI via the background worker (see
// background.js for why the fetch can't happen here). Each entry is mapped
// onto the day-rows present on THIS page, filled, and saved one day at a time.
// It NEVER submits the timesheet itself.

(function () {
  "use strict";

  // JobX field-id contract (verified live): per day, ids are
  //   Skin_body_ctl01_{StartHour1|StartMinute1|StartAmPm1|EndHour1|EndMinute1|EndAmPm1|PayCodes1}_<MMDDYYYY>120000
  // and the per-day Save button is Skin_body_ctl01_AddButton_<MMDDYYYY>120000.
  const ID_PREFIX = "Skin_body_ctl01_";
  const ID_SUFFIX = "120000";

  // Read once while the extension context is live; see extensionOk().
  const VERSION = chrome.runtime.getManifest().version;
  const ICON_URL = chrome.runtime.getURL("icons/icon48.png");

  // After the extension is reloaded in chrome://extensions, any content script
  // already injected into an open tab is "orphaned": its `chrome.storage` and
  // `chrome.runtime.id` become undefined, and touching them throws. Guard every
  // extension API call through here so we surface a clear instruction instead.
  function extensionOk() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local &&
      chrome.runtime && chrome.runtime.id;
  }
  function requireStorage() {
    if (!extensionOk()) {
      throw new Error("EXTENSION_RELOADED");
    }
  }

  // ── Detect the day-rows present on this page ──────────────────────────────
  function daysOnPage() {
    const set = new Set();
    document.querySelectorAll("select,input").forEach((el) => {
      const m = (el.id || "").match(/_(\d{8})120000$/);
      if (m) set.add(m[1]);
    });
    return set;
  }

  // JobX day key (MMDDYYYY) ↔ DALI date (YYYY-MM-DD).
  function dayKey(isoDate) {
    const [Y, M, D] = isoDate.split("-");
    return M + D + Y;
  }
  function isoFromKey(k) {
    return `${k.slice(4, 8)}-${k.slice(0, 2)}-${k.slice(2, 4)}`;
  }
  function pageDates() {
    return Array.from(daysOnPage()).map(isoFromKey).sort();
  }

  // "HH:mm" (24h wall-clock, as DALI sends it) → JobX's 12h select values.
  function clockParts(hhmm) {
    const [HH, MM] = hhmm.split(":");
    const H = +HH;
    let h12 = H % 12;
    if (h12 === 0) h12 = 12;
    return { h12: String(h12), min: MM, ampm: H < 12 ? "AM" : "PM" };
  }

  function highlight(el) {
    el.style.outline = "2px solid #0f6e7d";
    el.style.outlineOffset = "1px";
    el.style.borderRadius = "4px";
  }

  // The per-day Save button: Skin_body_ctl01_AddButton_<date>120000.
  function saveButtonFor(k) {
    return document.getElementById(ID_PREFIX + "AddButton_" + k);
  }

  // Fill one day's fields in the ISOLATED world (CSP-safe). Returns true if all
  // editable fields + the Save button were found. Filling and SAVING are split
  // (see saveDay) so ASP.NET's onchange handlers commit the values before the
  // postback fires — clicking Save in the same tick posts back stale/empty data.
  function fillDay(k, step) {
    const P = ID_PREFIX;
    const pairs = [
      [P + "PayCodes1_" + k, "1"],
      [P + "StartHour1_" + k, step.sh],
      [P + "StartMinute1_" + k, step.sm],
      [P + "StartAmPm1_" + k, step.sap],
      [P + "EndHour1_" + k, step.eh],
      [P + "EndMinute1_" + k, step.em],
      [P + "EndAmPm1_" + k, step.eap],
    ];
    // IMPORTANT: do NOT dispatch 'change'. JobX has an onchange handler that does
    // jQuery `$('#' + this.name)`, and the control's NAME contains '$'
    // (Skin$body$ctl01$…), which jQuery can't parse — it throws "unrecognized
    // expression" and ABORTS the save flow. ASP.NET serializes the form's current
    // input VALUES on postback regardless of change events, so setting .value is
    // enough; firing change only triggers JobX's broken handler. Set silently.
    let allFound = true;
    for (const [id, val] of pairs) {
      const el = document.getElementById(id);
      if (!el) { allFound = false; continue; }
      el.value = String(val);
      highlight(el);
    }
    // The note field is date-keyed like the time fields, but "TSENote" has no
    // trailing digit (unlike "StartHour1").
    const note = document.getElementById(P + "TSENote_" + k);
    if (note) {
      note.value = step.note || "";
      highlight(note);
    }
    return allFound && !!document.getElementById(P + "AddButton_" + k);
  }

  // Trigger the day's Save AFTER fillDay + a settle delay. The Save button is
  // <input type=submit> whose onclick runs WebForm_DoPostBackWithOptions(target,
  // "", true, …) — `true` = validate. A native .click() runs that onclick
  // (validation → __doPostBack) and submits via the page's own path. CSP-safe;
  // no form.submit() (that bypasses validation/__doPostBack → loads but no save).
  function saveDay(k) {
    const save = document.getElementById(ID_PREFIX + "AddButton_" + k);
    if (!save || typeof save.click !== "function") return false;
    save.click();
    return true;
  }

  // ── Resume-after-reload engine ────────────────────────────────────────────
  //
  // JobX saves each day via an ASP.NET postback that reloads the page, wiping any
  // other unsaved fills. So we can't fill all days at once. Instead we persist a
  // "plan" (the remaining days to enter) in chrome.storage.local, fill+save ONE
  // day, let the page reload, then on the next load auto-continue with the next
  // day — repeating until the plan is empty. The panel is the one confirmation
  // up front; hands-off after.

  const PLAN_KEY = "fillPlan";
  const MAX_STEPS = 60; // safety cap (a 14-day period, a few blocks a day); guards against loops.

  // Turn a DALI payload into a plan: only entries whose day exists on this page,
  // each a self-contained instruction the resume loop can execute after any
  // reload. `skipped` carries the rest with the reason, for the panel to show.
  function buildPlan(payload) {
    const present = daysOnPage();
    const steps = [], skipped = [];
    for (const e of (payload.entries || [])) {
      const key = dayKey(e.date);
      if (!present.has(key)) { skipped.push({ entry: e, reason: "Not on this JobX page" }); continue; }
      // JobX takes one day per row; a block that runs past midnight can't be
      // entered as-is, so leave it for the member rather than save it wrong.
      if (e.end <= e.start) { skipped.push({ entry: e, reason: "Runs past midnight" }); continue; }
      const s = clockParts(e.start), en = clockParts(e.end);
      steps.push({
        key,
        sh: s.h12, sm: s.min, sap: s.ampm,
        eh: en.h12, em: en.min, eap: en.ampm,
        note: (e.description || "").trim() || payload.hireLabel || "",
        label: `${formatDate(e.date)}, ${formatTime(e.start)}–${formatTime(e.end)}`,
      });
    }
    return { steps, skipped, hireLabel: payload.hireLabel || "this role", stepsDone: 0, total: steps.length };
  }

  async function startPlan(payload) {
    const plan = buildPlan(payload);
    if (!plan.steps.length) return;
    requireStorage();
    await chrome.storage.local.set({ [PLAN_KEY]: plan });
    state.open = false;
    await updateButtons();
    runPlanStep(); // kick off; subsequent steps fire on each reload via init
  }

  // Execute the next step of a stored plan, if any. Fills one day, clicks its
  // Save (which reloads the page); init() on the next load calls this again.
  async function runPlanStep() {
    requireStorage();
    const store = await chrome.storage.local.get(PLAN_KEY);
    const plan = store[PLAN_KEY];
    if (!plan || !plan.steps) return;

    if (plan.stepsDone >= MAX_STEPS) {
      await chrome.storage.local.remove(PLAN_KEY);
      await updateButtons();
      toast("Stopped: step limit reached. Check your JobX entries.", true);
      return;
    }

    // The persisted `steps` list IS the source of truth: each block is popped and
    // saved before the page reloads, so on resume steps[0] is always the next
    // unsaved block. This naturally handles multiple blocks on the same day — we
    // do NOT skip a day just because it already has one saved entry.
    if (!plan.steps.length) {
      await chrome.storage.local.remove(PLAN_KEY);
      await updateButtons();
      toast(`Done — saved ${plan.total || plan.stepsDone} entr${(plan.total || plan.stepsDone) === 1 ? "y" : "ies"} for ${plan.hireLabel}. Review them in JobX, then submit when you're ready.`, false);
      return;
    }

    const step = plan.steps[0];
    const k = step.key + ID_SUFFIX;
    const present = daysOnPage();
    if (!present.has(step.key)) {
      // This day isn't on the current page — skip it and move on next tick.
      plan.steps.shift();
      await chrome.storage.local.set({ [PLAN_KEY]: plan });
      runPlanStep();
      return;
    }

    // Verify the editable fields + save button exist for this day before we
    // commit to it (in the isolated world, just for the missing-check + highlight).
    const checkIds = [
      ID_PREFIX + "StartHour1_" + k, ID_PREFIX + "StartMinute1_" + k, ID_PREFIX + "StartAmPm1_" + k,
      ID_PREFIX + "EndHour1_" + k, ID_PREFIX + "EndMinute1_" + k, ID_PREFIX + "EndAmPm1_" + k,
    ];
    const missing = checkIds.filter((id) => !document.getElementById(id));
    const save = saveButtonFor(k);
    if (!save || missing.length) {
      // Don't half-fill / save a broken day. Abort so nothing wrong is committed.
      await chrome.storage.local.remove(PLAN_KEY);
      await updateButtons();
      toast(`Stopped at ${step.label}: ${!save ? "no Save button" : "missing fields"}. Nothing saved for that day.`, true);
      return;
    }

    // Pop this step BEFORE saving: the save reloads the page; on reload the
    // shifted plan continues with the next step (incl. a 2nd block same day).
    plan.steps.shift();
    plan.stepsDone += 1;
    await chrome.storage.local.set({ [PLAN_KEY]: plan });
    await updateButtons();
    toast(`Saving ${step.label}…`, false);

    // 1) Fill the day's fields. 2) Wait so ASP.NET's onchange handlers commit the
    // values. 3) Click Save (the page's own postback path). The page reloads on
    // save; waitUntilReady() in init() resumes the next step after that settles.
    setTimeout(() => {
      const ok = fillDay(k, step);
      if (!ok) {
        toast(`Missing fields for ${step.label}; nothing saved. Click Save manually.`, true);
        return;
      }
      // Gap between fill and save is the fix for "loads but doesn't save": the
      // change handlers must run before the postback serializes the form.
      setTimeout(() => {
        const saved = saveDay(k);
        if (!saved) {
          toast(`Couldn't trigger Save for ${step.label}. Click its Save Entry manually.`, true);
          return;
        }
        // If Save is an in-place async postback (no full navigation), keep the
        // loop going after the loading clears. If it was a full reload, this frame
        // is already gone and init() drives the resume — harmless either way.
        watchForInPlaceCompletion();
      }, 700);
    }, 300);
  }

  // Handle the case where Save is an in-place async postback (the page does NOT
  // fully navigate, so init() never re-fires). Wait for the loading overlay to
  // appear (save in flight) and then clear (save done), then run the next step.
  // If the page actually did a full reload, this function's frame is already gone
  // and init() drives the resume instead — so this is a no-op in that case.
  function watchForInPlaceCompletion() {
    let sawLoading = false;
    let tries = 0;
    const maxTries = 150; // 30s
    const poll = () => {
      tries++;
      const loading = isLoadingOverlayVisible();
      if (loading) sawLoading = true;
      if (sawLoading && !loading) {
        setTimeout(() => runPlanStep(), 400);
        return;
      }
      if (tries >= maxTries) return; // give up quietly; user can re-click Fill
      setTimeout(poll, 200);
    };
    setTimeout(poll, 200);
  }

  async function stopPlan() {
    await chrome.storage.local.remove(PLAN_KEY);
    toast("Auto-fill stopped. Entries already saved stay in JobX.", false);
  }

  async function activePlan() {
    const store = await chrome.storage.local.get(PLAN_KEY);
    const plan = store[PLAN_KEY];
    return plan && plan.steps && plan.steps.length ? plan : null;
  }

  // ── DALI data (via the background worker) ─────────────────────────────────
  async function fetchExport(params) {
    requireStorage();
    const res = await chrome.runtime.sendMessage({ type: "dali:export", params });
    if (!res) throw new Error("The extension didn't respond — refresh this page and try again.");
    return res;
  }

  // ── Formatting ────────────────────────────────────────────────────────────
  function formatDate(isoDate) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
    }).format(new Date(isoDate + "T00:00:00Z"));
  }
  function formatTime(hhmm) {
    const p = clockParts(hhmm);
    return `${p.h12}:${p.min} ${p.ampm}`;
  }
  function formatHours(h) {
    return `${Number(h.toFixed(2))}h`;
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  // Rendered into a shadow root so JobX's stylesheet can't reach in (and ours
  // can't leak out). The palette is dali.os light mode — the same tokens as
  // dali-api/app/app.css `html.light` — so the panel reads as part of DALI OS.
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .dali {
      --bg: #e9eef3; --card: #ffffff; --card-hover: #eaf3f8; --well: #eaeff5;
      --container: #ccd7e2; --container-hi: #a9b9c9;
      --accent: #0f6e7d; --accent-hover: #0b5964; --accent-tint: #dcecf0;
      --grey: #4d5c69; --muted: #78899a; --fg: #13293a;
      --green: #0f7a4d; --amber: #8f5400; --danger: #c0362f;
      --shadow: 0 12px 40px rgba(19, 41, 58, 0.18), 0 2px 6px rgba(19, 41, 58, 0.10);
      --r-card: 24px; --r-item: 12px;
      font: 13px/1.45 "Mulish", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: var(--fg);
      -webkit-font-smoothing: antialiased;
    }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:disabled { cursor: default; }
    button:focus-visible, select:focus-visible, a:focus-visible {
      outline: 2px solid var(--accent); outline-offset: 2px;
    }

    .dock {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
    }

    .launcher {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--accent); color: #fff; border: 0; border-radius: 999px;
      padding: 8px 16px 8px 8px; font-weight: 700; font-size: 14px;
      box-shadow: var(--shadow); transition: background 120ms, transform 120ms;
    }
    .launcher:hover { background: var(--accent-hover); }
    .launcher:active { transform: scale(0.98); }
    .launcher img { width: 26px; height: 26px; border-radius: 50%; display: block; }
    .progress {
      display: inline-flex; align-items: center; gap: 10px;
      background: var(--card); border-radius: 999px; padding: 6px 6px 6px 16px;
      box-shadow: var(--shadow); font-weight: 600;
    }
    .progress .spinner { border-color: var(--accent-tint); border-top-color: var(--accent); }

    .panel {
      width: 380px; max-width: calc(100vw - 40px); max-height: calc(100vh - 110px);
      display: flex; flex-direction: column;
      background: var(--card); border-radius: var(--r-card); box-shadow: var(--shadow);
      overflow: hidden; animation: rise 160ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .head {
      display: flex; align-items: baseline; gap: 10px; padding: 18px 16px 6px 22px;
    }
    .logo {
      font-family: "Plus Jakarta Sans", "Mulish", ui-sans-serif, system-ui, sans-serif;
      font-size: 20px; font-weight: 700; color: var(--accent); letter-spacing: -0.01em;
    }
    .title { color: var(--grey); font-weight: 600; flex: 1; }
    .icon-btn {
      border: 0; background: transparent; color: var(--grey); width: 30px; height: 30px;
      border-radius: 50%; font-size: 15px; line-height: 1; align-self: center;
    }
    .icon-btn:hover { background: rgba(19, 41, 58, 0.06); color: var(--fg); }

    .body { padding: 8px 22px 4px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }
    .section-label {
      display: flex; align-items: baseline; justify-content: space-between;
      font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
      color: var(--muted); margin: 0 0 6px;
    }
    .section-label span:last-child { text-transform: none; letter-spacing: 0; font-weight: 600; }

    .select-wrap { position: relative; }
    .select-wrap::after {
      content: ""; position: absolute; right: 14px; top: 50%; width: 7px; height: 7px;
      border-right: 2px solid var(--grey); border-bottom: 2px solid var(--grey);
      transform: translateY(-70%) rotate(45deg); pointer-events: none;
    }
    select {
      appearance: none; width: 100%; font: inherit; font-weight: 600; color: var(--fg);
      background: var(--well); border: 1px solid transparent; border-radius: var(--r-item);
      padding: 10px 36px 10px 12px;
    }
    select:hover { border-color: var(--container-hi); }

    .periods {
      display: flex; flex-direction: column; gap: 4px; max-height: 196px; overflow-y: auto;
      margin: 0 -6px; padding: 0 6px;
    }
    .period {
      display: flex; align-items: center; gap: 10px; width: 100%; text-align: left;
      background: transparent; border: 1px solid transparent; border-radius: var(--r-item);
      padding: 9px 10px;
    }
    .period:hover { background: var(--card-hover); }
    .period.on { background: var(--accent-tint); border-color: var(--accent); }
    .radio {
      width: 16px; height: 16px; flex: none; border-radius: 50%;
      border: 2px solid var(--container-hi); background: var(--card);
    }
    .period.on .radio { border: 5px solid var(--accent); }
    .p-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .p-label { font-weight: 700; }
    .p-meta { color: var(--grey); font-size: 12px; }
    .badge {
      flex: none; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px;
      background: var(--well); color: var(--grey);
    }
    .badge.accent { background: var(--accent); color: #fff; }

    .entries { display: flex; flex-direction: column; background: var(--well); border-radius: var(--r-item); }
    .entry { display: grid; grid-template-columns: 1fr auto; gap: 1px 12px; padding: 9px 12px; }
    .entry + .entry { border-top: 1px solid var(--container); }
    .entry .when { font-weight: 700; }
    .entry .hrs { font-weight: 700; color: var(--accent); text-align: right; }
    .entry .note { grid-column: 1 / -1; color: var(--grey); font-size: 12px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .entry.skip { opacity: 0.6; }
    .entry.skip .hrs { color: var(--amber); font-size: 11px; }

    .notice {
      border-radius: var(--r-item); padding: 10px 12px; font-size: 12px;
      background: #fbf1df; color: var(--amber);
    }
    .notice.neutral { background: var(--well); color: var(--grey); }

    .foot { padding: 14px 22px 20px; display: flex; flex-direction: column; gap: 8px; }
    .primary {
      width: 100%; border: 0; border-radius: var(--r-item); padding: 12px 16px;
      background: var(--accent); color: #fff; font-weight: 700; font-size: 14px;
      transition: background 120ms;
    }
    .primary:hover:not(:disabled) { background: var(--accent-hover); }
    .primary:disabled { background: var(--container); color: var(--grey); }
    .secondary {
      border: 1px solid var(--container); background: var(--card); border-radius: var(--r-item);
      padding: 9px 14px; font-weight: 700;
    }
    .secondary:hover { border-color: var(--container-hi); background: var(--card-hover); }
    .stop {
      border: 0; border-radius: 999px; padding: 7px 14px; font-weight: 700;
      background: #f6e1df; color: var(--danger);
    }
    .stop:hover { background: #efcdc9; }
    .fine { color: var(--muted); font-size: 12px; text-align: center; }

    .empty { display: flex; flex-direction: column; align-items: center; text-align: center;
      gap: 12px; padding: 22px 8px 26px; color: var(--grey); }
    .empty strong { color: var(--fg); font-size: 14px; }
    .row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }

    .spinner {
      width: 16px; height: 16px; border-radius: 50%; flex: none;
      border: 2px solid var(--container); border-top-color: var(--accent);
      animation: spin 700ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .loading-bar { height: 2px; background: var(--accent-tint); overflow: hidden; }
    .loading-bar::after {
      content: ""; display: block; height: 100%; width: 40%; background: var(--accent);
      animation: slide 900ms ease-in-out infinite;
    }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(250%); } }

    .toast {
      max-width: 360px; background: var(--fg); color: #fff; border-radius: 16px;
      padding: 12px 16px; box-shadow: var(--shadow); white-space: pre-wrap;
      animation: rise 160ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    .toast.error { background: var(--danger); }
  `;

  const state = {
    open: false,
    loading: false,
    data: null,
    error: null,
    signedOut: false,
    base: "",
    plan: null,
    toast: null,
  };
  let ui = null;

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (k === "class") el.className = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function mount() {
    if (document.getElementById("dali-jobx-host")) return;
    const host = document.createElement("div");
    host.id = "dali-jobx-host";
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.appendChild(h("style", null, CSS));
    ui = h("div", { class: "dali" });
    shadow.appendChild(ui);
    render();
  }

  function render() {
    if (!ui) return;
    const dock = h("div", { class: "dock" },
      state.toast && h("div", { class: "toast" + (state.toast.isError ? " error" : ""), role: "status" }, state.toast.text),
      state.open && !state.plan && renderPanel(),
      state.plan ? renderProgress() : renderLauncher(),
    );
    ui.replaceChildren(dock);
  }

  function renderLauncher() {
    return h("button", {
      class: "launcher", type: "button", "aria-expanded": String(state.open),
      title: `DALI OS → JobX v${VERSION}`,
      onclick: () => (state.open ? closePanel() : openPanel()),
    },
      h("img", { src: ICON_URL, alt: "" }),
      "Fill from DALI",
    );
  }

  function renderProgress() {
    const p = state.plan;
    return h("div", { class: "progress", role: "status" },
      h("span", { class: "spinner" }),
      `Saving ${p.stepsDone} of ${p.total || p.stepsDone + p.steps.length}…`,
      h("button", { class: "stop", type: "button", onclick: () => stopPlan().then(updateButtons) }, "Stop"),
    );
  }

  function renderPanel() {
    return h("section", { class: "panel", role: "dialog", "aria-label": "Fill JobX from DALI OS" },
      h("div", { class: "head" },
        h("span", { class: "logo" }, "dali.os"),
        h("span", { class: "title" }, "JobX timesheet"),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: closePanel }, "✕"),
      ),
      state.loading ? h("div", { class: "loading-bar" }) : h("div", { style: "height:2px" }),
      renderPanelContent(),
    );
  }

  function renderPanelContent() {
    const d = state.data;
    if (state.signedOut) {
      return h("div", { class: "body" }, h("div", { class: "empty" },
        h("strong", null, "Sign in to DALI OS"),
        h("span", null, `The extension reads your hours from ${state.base}. Sign in there in this browser, then come back.`),
        h("div", { class: "row" },
          h("button", { class: "primary", type: "button", style: "width:auto", onclick: () => window.open(state.base, "_blank", "noopener") }, "Open DALI OS"),
          h("button", { class: "secondary", type: "button", onclick: () => load(currentParams()) }, "Try again"),
        ),
      ));
    }
    if (state.error) {
      return h("div", { class: "body" }, h("div", { class: "empty" },
        h("strong", null, "Couldn't load your hours"),
        h("span", null, state.error),
        h("button", { class: "secondary", type: "button", onclick: () => load(currentParams()) }, "Try again"),
      ));
    }
    if (!d) {
      return h("div", { class: "body" }, h("div", { class: "empty" },
        h("span", { class: "spinner" }), "Loading your hours…",
      ));
    }
    if (!d.availableHires.length) {
      return h("div", { class: "body" }, h("div", { class: "empty" },
        h("strong", null, "No roles yet"),
        h("span", null, "DALI OS doesn't have a paid role or logged hours for you. Log hours on your Timesheet tab first."),
      ));
    }

    const dates = pageDates();
    const onPage = (p) => dates.some((iso) => iso >= p.start && iso <= p.end);
    const selected = d.periods.find((p) => p.key === d.periodKey);
    const plan = buildPlan(d);
    const skipped = new Map(plan.skipped.map((s) => [s.entry, s.reason]));

    const role = h("div", null,
      h("label", { class: "section-label", for: "dali-role" }, h("span", null, "Role")),
      h("div", { class: "select-wrap" },
        h("select", { id: "dali-role", disabled: state.loading, onchange: (ev) => pickHire(ev.target.value) },
          d.availableHires.map((hire) =>
            h("option", { value: hire.key, selected: hire.key === d.hireKey }, hire.label)),
        ),
      ),
    );

    const periods = h("div", null,
      h("div", { class: "section-label" }, h("span", null, "Pay period")),
      d.periods.length
        ? h("div", { class: "periods", role: "radiogroup", "aria-label": "Pay period" },
          d.periods.map((p) => {
            const on = p.key === d.periodKey;
            return h("button", {
              class: "period" + (on ? " on" : ""), type: "button", role: "radio",
              "aria-checked": String(on), disabled: state.loading,
              onclick: () => { if (!on) pickPeriod(p.key); },
            },
              h("span", { class: "radio" }),
              h("span", { class: "p-main" },
                h("span", { class: "p-label" }, p.label),
                h("span", { class: "p-meta" },
                  p.entryCount ? `${formatHours(p.hours)} · ${plural(p.entryCount, "entry", "entries")}` : "No hours logged"),
              ),
              onPage(p) && h("span", { class: "badge accent" }, "This page"),
              p.current && !onPage(p) && h("span", { class: "badge" }, "Current"),
            );
          }))
        : h("div", { class: "notice neutral" }, "No hours logged for this role in the last year."),
    );

    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const entries = selected && h("div", null,
      h("div", { class: "section-label" },
        h("span", null, plural(d.entries.length, "entry", "entries")),
        d.timezone !== zone && h("span", null, `Times in ${d.timezone}`),
      ),
      d.entries.length
        ? h("div", { class: "entries" }, d.entries.map((e) => {
          const reason = skipped.get(e);
          return h("div", { class: "entry" + (reason ? " skip" : "") },
            h("span", { class: "when" }, `${formatDate(e.date)} · ${formatTime(e.start)}–${formatTime(e.end)}`),
            h("span", { class: "hrs" }, reason || formatHours(e.hours)),
            e.description && h("span", { class: "note", title: e.description }, e.description),
          );
        }))
        : h("div", { class: "notice neutral" }, "Nothing logged for this role in this pay period."),
    );

    let notice = null;
    if (!dates.length) {
      notice = h("div", { class: "notice" }, "This JobX page has no editable days. Open the Manage Time Sheet page for an open pay period.");
    } else if (selected && !onPage(selected)) {
      notice = h("div", { class: "notice" }, `This JobX page is a different pay period. Open ${selected.label} in JobX to fill it.`);
    } else if (plan.skipped.length && plan.steps.length) {
      notice = h("div", { class: "notice" }, `${plural(plan.skipped.length, "entry", "entries")} can't be filled and will be skipped.`);
    }

    const n = plan.steps.length;
    return [
      h("div", { class: "body" }, role, periods, entries, notice),
      h("div", { class: "foot" },
        h("button", {
          class: "primary", type: "button", disabled: state.loading || !n,
          onclick: () => startPlan(d).catch(handleError),
        }, n ? `Fill & save ${plural(n, "entry", "entries")}` : "Nothing to fill"),
        h("div", { class: "fine" }, "Saves each day in JobX, one at a time. It never submits your timesheet."),
      ),
    ];
  }

  function currentParams() {
    return {
      hire: state.data && state.data.hireKey,
      period: (state.data && state.data.periodKey) || pageDates()[0],
    };
  }

  async function load(params) {
    state.loading = true;
    state.error = null;
    state.signedOut = false;
    render();
    try {
      const res = await fetchExport(params);
      state.base = res.base;
      if (res.ok) {
        state.data = res.data;
      } else {
        state.data = null;
        state.error = res.error;
        state.signedOut = !!res.signedOut;
      }
    } catch (err) {
      state.data = null;
      state.error = err && err.message === "EXTENSION_RELOADED"
        ? "The extension was updated. Refresh this JobX page (⌘R) and try again."
        : (err && err.message) || String(err);
    } finally {
      state.loading = false;
      render();
    }
  }

  async function openPanel() {
    state.open = true;
    render();
    try {
      requireStorage();
      const { daliHireKey } = await chrome.storage.sync.get("daliHireKey");
      // The JobX page's own period is the likeliest one to fill, so ask for it
      // by date; DALI lists it even if nothing's logged there yet.
      await load({ hire: daliHireKey, period: pageDates()[0] });
    } catch (err) {
      handleError(err);
    }
  }

  function closePanel() {
    state.open = false;
    render();
  }

  function pickHire(hireKey) {
    if (extensionOk()) chrome.storage.sync.set({ daliHireKey: hireKey });
    load({ hire: hireKey, period: (state.data && state.data.periodKey) || pageDates()[0] });
  }

  function pickPeriod(periodKey) {
    load({ hire: state.data && state.data.hireKey, period: periodKey });
  }

  async function updateButtons() {
    state.plan = extensionOk() ? await activePlan() : null;
    render();
  }

  function toast(text, isError) {
    state.toast = { text, isError };
    render();
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { state.toast = null; render(); }, 12000);
  }

  function handleError(err) {
    if (err && err.message === "EXTENSION_RELOADED") {
      toast("The extension was updated. Refresh this JobX page (⌘R), then try again.", true);
    } else {
      toast((err && err.message) || String(err), true);
    }
  }

  // The manage/entry page is the only one with day-rows to fill. JobX serves it
  // at a path that may be any case (e.g. tsx_stumanagetimesheet.aspx), and Chrome
  // match patterns are case-sensitive, so we match the whole host in the manifest
  // and gate here case-insensitively instead.
  function isManagePage() {
    return /tsx_stumanagetimesheet\.aspx/i.test(location.pathname);
  }

  // After the save postback, JobX reloads the page AND then fetches the timesheet
  // data via a separate XHR (Tsx_FetchHireInfo.aspx?i=pp...) that populates the
  // day rows asynchronously. Acting before that XHR completes hits an empty/half-
  // built form. So we wait for the next step's editable field to be present AND
  // STABLE — unchanged across several consecutive checks — which means the data
  // fetch has landed and settled. Then an extra settle delay before filling.
  function waitUntilReady(nextKey) {
    return new Promise((resolve) => {
      const startHourId = ID_PREFIX + "StartHour1_" + nextKey + ID_SUFFIX;
      let tries = 0;
      let stableCount = 0;
      const maxTries = 200;          // 200 × 250ms = 50s ceiling
      const STABLE_NEEDED = 4;       // field present for 4×250ms = 1s straight
      const tick = () => {
        tries++;
        const loading = isLoadingOverlayVisible();
        const field = document.getElementById(startHourId);
        // Ready signal: field exists, not disabled, and no loading overlay.
        const ready = !!field && !field.disabled && !loading;
        stableCount = ready ? stableCount + 1 : 0;
        if (stableCount >= STABLE_NEEDED) {
          // One more settle beat so any trailing onchange wiring finishes.
          setTimeout(() => resolve(true), 500);
          return;
        }
        if (tries >= maxTries) { resolve(false); return; }
        setTimeout(tick, 250);
      };
      tick();
    });
  }

  // Heuristic for JobX's "data loading" overlay. JobX's data fetch
  // (Tsx_FetchHireInfo) shows a loading state; ASP.NET UpdateProgress panels also
  // use a visible "loading"/"progress" element. Treat any visible such element as
  // "still loading". Also treat document.readyState !== 'complete' as loading.
  // Our own UI lives in a shadow root, so its spinner never matches here.
  function isLoadingOverlayVisible() {
    if (document.readyState !== "complete") return true;
    const nodes = document.querySelectorAll(
      '[id*="loading" i], [class*="loading" i], [id*="UpdateProgress" i], ' +
      '[class*="updateprogress" i], [id*="progress" i], [class*="spinner" i], [class*="busy" i]'
    );
    for (const n of nodes) {
      const style = window.getComputedStyle(n);
      if (style.display !== "none" && style.visibility !== "hidden" && n.offsetParent !== null) {
        return true;
      }
    }
    return false;
  }

  // ── Init: on every page load, inject UI and resume any active plan ─────────
  async function init() {
    if (!isManagePage()) return;
    mount();
    // Read the raw plan, not activePlan(): the last save's reload arrives with
    // an emptied plan, and runPlanStep() is what clears it and reports "Done".
    const plan = (await chrome.storage.local.get(PLAN_KEY))[PLAN_KEY];
    if (!plan) return;
    if (plan.steps && plan.steps.length) {
      state.plan = plan;
      render();
      // Wait for the next step's own fields to be ready before filling.
      await waitUntilReady(plan.steps[0].key);
    }
    runPlanStep();
  }

  init();
})();
