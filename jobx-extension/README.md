# DALI → JobX Timesheet Filler (Chrome extension)

Pre-fills the Dartmouth JobX (`Tsx_StuManageTimesheet.aspx`) timesheet from your
**finalized** DALI OS hours. It fills the Start/End/PayCode dropdowns and
highlights them — it **never** clicks Save or submits. You review and Save.

No bookmarks. Install once; a green **"Fill from DALI"** button appears on the
JobX timesheet page.

## How it works

- The content script runs only on `Tsx_StuManageTimesheet.aspx`.
- On click it `fetch`es `<DALI>/api/timesheets/export?period=current` with
  `credentials: "include"`. Because the extension holds `host_permissions` for
  the DALI origin, the browser attaches your `__dali_sid` session cookie even
  though JobX is a different site (a plain bookmarklet can't do this — the cookie
  is `SameSite=Lax`).
- It auto-detects the day-rows on the open pay period (parsing the `MMDDYYYY` off
  the field ids), maps each DALI entry onto its day by date, and fills the
  dropdowns. Dates not on the open period are skipped and reported.

## Install (developer / sideload)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this `jobx-extension/` folder.
4. Click the extension's icon → set **DALI base URL** if needed
   (`http://localhost:5173` for local dev; the DALI domain in prod). Blank =
   auto-try localhost then the DALI domain.

## Use

1. Log into DALI OS in the same browser; finalize a timesheet period.
2. Open the JobX **Manage Time Sheet** page for the matching open pay period.
3. Click **📋 Fill from DALI** (bottom-right).
4. Review the highlighted rows, click each day's **Save Entry** in JobX.

## Notes / limits

- Requires the DALI endpoint `/api/timesheets/export` (built with the Timesheets
  feature). Until that ships, use the standalone `jobx-bookmarklet-test.html`
  paste flow to exercise the fill logic.
- Fills only — never submits. A wrong value can't reach payroll without your Save.
- Replace the placeholder icons in `icons/` before any real distribution.
- For non-dev distribution, pack/publish via the Chrome Web Store (or an
  enterprise policy) so members don't need Developer mode.
