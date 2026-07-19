# DALI → JobX Timesheet Filler (Chrome extension)

Fills the Dartmouth JobX (`Tsx_StuManageTimesheet.aspx`) timesheet from your
DALI OS **Timesheet tab** hours (`dali-api/app/calendar/routes/calendar.tsx`) —
attendance-derived entries from meeting notes plus anything you logged
manually. It fills each day's Start/End/PayCode fields and clicks that day's
**Save Entry** itself, one day at a time, resuming automatically as JobX
reloads the page after each save. It never clicks the final timesheet
submit — only the per-day Save Entry postback, which you can review in JobX
afterward (nothing reaches payroll until you submit the period there).

No bookmarks. Install once; a green **"📋 Fill from DALI"** button appears on
the JobX timesheet page.

## How it works

- The content script runs only on `Tsx_StuManageTimesheet.aspx`.
- On click it `fetch`es `<DALI>/api/timesheets/export` (optionally
  `?hire=<key>` — see below) with `credentials: "include"`. Because the
  extension holds `host_permissions` for the DALI origin, the browser
  attaches your `__dali_sid` session cookie even though JobX is a different
  site (a plain bookmarklet can't do this — the cookie is `SameSite=Lax`).
- It auto-detects the day-rows present on the open pay period (parsing the
  `MMDDYYYY` off the field ids), maps each DALI entry onto its day by date,
  and asks you to confirm the full list before doing anything.
- After confirming, it fills and saves one day at a time. JobX's Save is a
  full-page ASP.NET postback, so the extension persists its remaining plan in
  `chrome.storage.local` and continues automatically on the next page load —
  hands-off until every entry is saved. Dates that don't land on the open
  period are skipped and reported.

## The DALI backend contract

`GET /api/timesheets/export` (`dali-api/app/routes/api.timesheets.export.ts`)
returns:

```json
{
  "hireKey": "project-dali-os",
  "hireLabel": "DALI OS",
  "availableHires": [{ "key": "project-dali-os", "label": "DALI OS" }],
  "entries": [
    { "startAt": "…", "endAt": "…", "description": "…", "projectLabel": "DALI OS" }
  ]
}
```

There's no separate JobX "hire"/job-code concept in DALI OS — each `hireKey`
is a Project the caller has logged Timesheet-tab hours against (or
`"unassigned"` for entries with no project), standing in for a JobX job.
`?hire=<key>` picks one; omit it for the first available. `?from=`/`?to=`
(ISO dates) bound the window; default is the trailing 30 days.

## Install (developer / sideload)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this `jobx-extension/` folder.
4. Click the extension's icon → set **DALI base URL** (required):
   `http://localhost:3001` for local dev, `https://os.dali.dartmouth.edu` in
   prod.

## Use

1. Log into DALI OS in the same browser and make sure your Timesheet tab has
   the hours you want for this pay period.
2. Open the JobX **Manage Time Sheet** page for the matching open pay period.
3. Click **📋 Fill from DALI** (bottom-right) and confirm the entry list.
4. The extension fills + saves each day automatically; watch the toast in the
   bottom-right for progress. Review the saved entries in JobX when it's done.

## Notes / limits

- Requires the DALI endpoint `/api/timesheets/export`, which ships in this
  repo — no separate backend setup needed.
- Saves per-day entries only — never the final period submission. A wrong
  value can't reach payroll without a separate submit step in JobX.
- Replace the placeholder icons in `icons/` before any real distribution.
- For non-dev distribution, pack/publish via the Chrome Web Store (or an
  enterprise policy) so members don't need Developer mode.
