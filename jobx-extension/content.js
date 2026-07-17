// DALI → JobX Timesheet Filler — content script.
//
// Runs on the JobX "Manage Time Sheet" page. Injects a floating "Fill from DALI"
// button. On click it fetches the member's finalized period from DALI (the
// browser attaches the __dali_sid cookie because this extension holds
// host_permissions for the DALI origin), maps each entry onto the day-rows
// present on THIS page (auto-detected), fills the Start/End/PayCode <select>s,
// highlights them, and stops. It NEVER clicks Save / submits.

(function () {
  "use strict";

  // JobX field-id contract (verified live): per day, ids are
  //   Skin_body_ctl01_{StartHour1|StartMinute1|StartAmPm1|EndHour1|EndMinute1|EndAmPm1|PayCodes1}_<MMDDYYYY>120000
  // and the per-day Save button is Skin_body_ctl01_AddButton_<MMDDYYYY>120000.
  const ID_PREFIX = "Skin_body_ctl01_";
  const ID_SUFFIX = "120000";

  // After the extension is reloaded in chrome://extensions, any content script
  // already injected into an open tab is "orphaned": its `chrome.storage` becomes
  // undefined, and touching it throws "Cannot read properties of undefined". Guard
  // every storage call through here so we surface a clear instruction instead.
  function storageOk() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }
  function requireStorage() {
    if (!storageOk()) {
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

  // ISO local wall-clock string → JobX day key + 12h components.
  function isoParts(iso) {
    const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) return null;
    const [, Y, Mo, D, HH, MM] = m;
    const H = +HH;
    const ampm = H < 12 ? "AM" : "PM";
    let h12 = H % 12;
    if (h12 === 0) h12 = 12;
    return { key: Mo + D + Y, h12: String(h12), min: MM, ampm };
  }

  function setSelect(id, value, filled, missing) {
    const el = document.getElementById(id);
    if (!el) { missing.push(id); return; }
    el.value = String(value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (el.value === String(value)) {
      highlight(el);
      filled.push(id);
    } else {
      missing.push(id + " (value " + value + " not selectable)");
    }
  }

  function highlight(el) {
    el.style.outline = "2px solid #f5a623";
    el.style.borderRadius = "3px";
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

  // The note field for a day is date-keyed like the time fields (verified live):
  //   Skin_body_ctl01_TSENote_<MMDDYYYY>120000
  // Note: "TSENote" has no trailing digit (unlike "StartHour1"). `k` is already
  // the date+suffix (e.g. 05242026120000).
  function noteFieldFor(k) {
    return document.getElementById(ID_PREFIX + "TSENote_" + k);
  }

  function setNote(k, text, notesFilled) {
    if (!text) return;
    const el = noteFieldFor(k);
    if (!el) return; // note field optional; don't treat as an error
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    highlight(el);
    notesFilled.push(k);
  }

  // Build the note text for an entry. Calendar event title (carried by DALI as
  // the entry description) is the source; fall back to projectLabel.
  function noteText(e) {
    return (e.description && e.description.trim()) ||
           (e.projectLabel && e.projectLabel.trim()) || "";
  }

  function hoursOf(s, en, entry) {
    // Display helper for the confirm dialog.
    const a = new Date(entry.startAt).getTime(), b = new Date(entry.endAt).getTime();
    const h = (b - a) / 3600000;
    return isFinite(h) && h > 0 ? h.toFixed(2).replace(/\.00$/, "") + "h" : "?";
  }

  // ── Resume-after-reload engine ────────────────────────────────────────────
  //
  // JobX saves each day via an ASP.NET postback that reloads the page, wiping any
  // other unsaved fills. So we can't fill all days at once. Instead we persist a
  // "plan" (the remaining days to enter) in chrome.storage.local, fill+save ONE
  // day, let the page reload, then on the next load auto-continue with the next
  // day — repeating until the plan is empty. One confirm up front; hands-off after.

  const PLAN_KEY = "fillPlan";
  const MAX_STEPS = 30; // safety cap (a period is 14 days); guards against loops.

  // Turn a DALI payload into a plan: only days that exist on this page, each a
  // self-contained instruction the resume loop can execute after any reload.
  function buildPlan(payload) {
    const present = daysOnPage();
    const steps = [], skipped = [];
    for (const e of (payload.entries || [])) {
      const s = isoParts(e.startAt), en = isoParts(e.endAt);
      if (!s || !en) continue;
      if (!present.has(s.key)) { skipped.push(s.key); continue; }
      steps.push({
        key: s.key,
        sh: s.h12, sm: s.min, sap: s.ampm,
        eh: en.h12, em: en.min, eap: en.ampm,
        note: noteText(e),
        label: `${s.key} ${s.h12}:${s.min} ${s.ampm}–${en.h12}:${en.min} ${en.ampm}` +
          ` (${hoursOf(s, en, e)})` + (noteText(e) ? ` — ${noteText(e)}` : ""),
      });
    }
    return { steps, skipped, hireLabel: payload.hireLabel || "this hire", stepsDone: 0 };
  }

  async function startPlan(payload) {
    const present = daysOnPage();
    if (!present.size) { toast("Open a Manage Time Sheet page for an open pay period first.", true); return; }
    const plan = buildPlan(payload);
    if (!plan.steps.length) {
      toast(`No matching days on this period.` + (plan.skipped.length ? ` (dates not here: ${plan.skipped.join(", ")})` : ""), true);
      return;
    }
    const ok = window.confirm(
      `Auto-fill & SAVE ${plan.steps.length} entr${plan.steps.length === 1 ? "y" : "ies"} to JobX for ${plan.hireLabel}:\n\n` +
      plan.steps.map((s) => "• " + s.label).join("\n") +
      (plan.skipped.length ? `\n\nSkipped (not on this period): ${plan.skipped.join(", ")}` : "") +
      `\n\nThe page saves and reloads once per entry (a day may have several). This writes to your JobX timesheet. Continue?`
    );
    if (!ok) return;
    requireStorage();
    await chrome.storage.local.set({ [PLAN_KEY]: plan });
    runPlanStep(); // kick off; subsequent steps fire on each reload via init
  }

  // Execute the next step of a stored plan, if any. Fills one day, clicks its
  // Save (which reloads the page); init() on the next load calls this again.
  async function runPlanStep() {
    requireStorage();
    const store = await chrome.storage.local.get(PLAN_KEY);
    const plan = store[PLAN_KEY];
    if (!plan || !plan.steps || !plan.steps.length) return;

    if (plan.stepsDone >= MAX_STEPS) {
      await chrome.storage.local.remove(PLAN_KEY);
      toast("Stopped: step limit reached. Check your JobX entries.", true);
      return;
    }

    // The persisted `steps` list IS the source of truth: each block is popped and
    // saved before the page reloads, so on resume steps[0] is always the next
    // unsaved block. This naturally handles multiple blocks on the same day — we
    // do NOT skip a day just because it already has one saved entry.
    if (!plan.steps.length) {
      await chrome.storage.local.remove(PLAN_KEY);
      toast(`✅ Done — saved all entries for ${plan.hireLabel}.`, false);
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
      toast(`⚠ Stopped at ${step.key}: ${!save ? "no Save button" : "missing fields"}. Nothing saved this day.`, true);
      return;
    }

    // Pop this step BEFORE saving: the save reloads the page; on reload the
    // shifted plan continues with the next step (incl. a 2nd block same day).
    plan.steps.shift();
    plan.stepsDone += 1;
    const remaining = plan.steps.length;
    await chrome.storage.local.set({ [PLAN_KEY]: plan });
    toast(`Saving ${step.key} (${remaining} entr${remaining === 1 ? "y" : "ies"} left)…`, false);

    // 1) Fill the day's fields. 2) Wait so ASP.NET's onchange handlers commit the
    // values. 3) Click Save (the page's own postback path). The page reloads on
    // save; waitUntilReady() in init() resumes the next step after that settles.
    setTimeout(() => {
      const ok = fillDay(k, step);
      if (!ok) {
        toast(`⚠ Missing fields for ${step.key}; nothing saved. Click Save manually.`, true);
        return;
      }
      // Gap between fill and save is the fix for "loads but doesn't save": the
      // change handlers must run before the postback serializes the form.
      setTimeout(() => {
        const saved = saveDay(k);
        if (!saved) {
          toast(`⚠ Couldn't trigger Save for ${step.key}. Click its Save Entry manually.`, true);
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
      // Done when: we saw a loading phase that has now cleared (in-place save), OR
      // we never saw loading within a short grace window (full reload took over,
      // or save was instant) — in which case just resume if a plan remains.
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
    toast("Auto-fill stopped.", false);
  }

  async function hasActivePlan() {
    const store = await chrome.storage.local.get(PLAN_KEY);
    return !!(store[PLAN_KEY] && store[PLAN_KEY].steps && store[PLAN_KEY].steps.length);
  }

  // ── Fetch timesheet sections from DALI ─────────────────────────────────────
  // The DALI Timesheet tab stores sections per hire; this pulls one hire's
  // sections in the extension payload shape. The optional stored `daliHireKey`
  // selects which hire (else DALI returns the primary hire). Always hits the
  // `daliBase` configured in the popup — no guessing across a hardcoded list
  // of candidate origins, since that risked silently trying the wrong host.
  async function fetchFromDali() {
    const { daliBase, daliHireKey } = await chrome.storage.sync.get(["daliBase", "daliHireKey"]);
    if (!daliBase) {
      throw new Error("Set a DALI base URL in the extension popup first.");
    }
    const qs = daliHireKey ? `?hire=${encodeURIComponent(daliHireKey)}` : "";
    let res;
    try {
      res = await fetch(daliBase.replace(/\/$/, "") + "/api/timesheets/export" + qs, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      throw new Error(`Could not reach DALI at ${daliBase} (${err.message}).`);
    }
    if (res.status === 401) throw new Error(`Not logged into DALI at ${daliBase}.`);
    if (res.status === 404) throw new Error(`No hires/sections at ${daliBase}.`);
    if (!res.ok) throw new Error(`DALI ${daliBase} returned ${res.status}.`);
    return await res.json();
  }

  // ── UI: floating buttons + toast ──────────────────────────────────────────
  function injectButton() {
    if (document.getElementById("dali-jobx-btn")) return;
    const wrap = document.createElement("div");
    wrap.id = "dali-jobx-wrap";
    Object.assign(wrap.style, {
      position: "fixed", right: "20px", bottom: "20px", zIndex: 999999,
      display: "flex", gap: "8px",
    });

    const btn = document.createElement("button");
    btn.id = "dali-jobx-btn";
    btn.type = "button";
    // Version stamp so you can confirm the freshly-reloaded code is live (if the
    // button still says an old version after reloading, the reload didn't take).
    btn.textContent = "📋 Fill from DALI (v0.9)";
    Object.assign(btn.style, {
      background: "#00693e", color: "#fff", border: "none", borderRadius: "8px",
      padding: "12px 16px", font: "600 14px system-ui, sans-serif", cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)",
    });
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Fetching from DALI…";
      try {
        requireStorage();
        const payload = await fetchFromDali();
        await startPlan(payload);
      } catch (err) {
        if (err && err.message === "EXTENSION_RELOADED") {
          toast("Extension was reloaded — refresh this JobX page (⌘R), then click again.", true);
        } else {
          toast(err.message, true);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "📋 Fill from DALI (v0.9)";
      }
    });

    const stop = document.createElement("button");
    stop.id = "dali-jobx-stop";
    stop.type = "button";
    stop.textContent = "⏹ Stop";
    Object.assign(stop.style, {
      background: "#b91c1c", color: "#fff", border: "none", borderRadius: "8px",
      padding: "12px 14px", font: "600 14px system-ui, sans-serif", cursor: "pointer",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)", display: "none",
    });
    stop.addEventListener("click", () => stopPlan().then(updateButtons));

    wrap.appendChild(btn);
    wrap.appendChild(stop);
    document.body.appendChild(wrap);
    updateButtons();
  }

  async function updateButtons() {
    const active = await hasActivePlan();
    const btn = document.getElementById("dali-jobx-btn");
    const stop = document.getElementById("dali-jobx-stop");
    if (btn) { btn.style.display = active ? "none" : "block"; }
    if (stop) { stop.style.display = active ? "block" : "none"; }
  }

  function toast(text, isError) {
    let t = document.getElementById("dali-jobx-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "dali-jobx-toast";
      Object.assign(t.style, {
        position: "fixed", right: "20px", bottom: "72px", zIndex: 999999,
        maxWidth: "360px", padding: "12px 14px", borderRadius: "8px",
        font: "13px/1.4 system-ui, sans-serif", color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)", whiteSpace: "pre-wrap",
      });
      document.body.appendChild(t);
    }
    t.style.background = isError ? "#b91c1c" : "#0f766e";
    t.textContent = text;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.remove(); }, 12000);
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
    injectButton();
    if (await hasActivePlan()) {
      updateButtons();
      // Peek at the next step so we can wait for ITS fields to be ready.
      const store = await chrome.storage.local.get(PLAN_KEY);
      const plan = store[PLAN_KEY];
      const nextKey = plan && plan.steps && plan.steps[0] && plan.steps[0].key;
      if (nextKey) {
        await waitUntilReady(nextKey);
      }
      runPlanStep();
    }
  }

  init();
})();
