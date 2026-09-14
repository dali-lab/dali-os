# DALI OS → JobX Timesheet (Chrome extension)

Fills the Dartmouth JobX (`Tsx_StuManageTimesheet.aspx`) timesheet from your
DALI OS **Timesheet tab** hours (`dali-api/app/calendar/routes/calendar.tsx`) —
attendance-derived entries from meeting notes plus anything you logged
manually. You pick one of your paid roles and one of its pay periods, review
the entries, and the extension fills each day's Start/End/PayCode/Note fields
and clicks that day's **Save Entry** itself, one day at a time, resuming
automatically as JobX reloads the page after each save. It never submits the
timesheet — nothing reaches payroll until you submit the period in JobX.

## How it works

- The content script runs only on `Tsx_StuManageTimesheet.aspx` and adds a
  **Fill from DALI** button (bottom-right). Clicking it opens a panel:
  **Role** → **Pay period** → the entries in that period → **Fill & save**.
- The panel opens on the pay period of the JobX page you're on (marked
  *This page*), so the common case is one click. Entries whose day isn't on
  the open JobX page are shown but skipped.
- All DALI requests go through the background service worker
  (`background.js`), not the content script. A content script's fetch counts
  as the JobX page's, so it's cross-site to DALI and Chrome drops the
  `SameSite=Lax` `__dali_sid` session cookie — every pull came back 401. The
  worker runs on the extension's origin with `host_permissions` for DALI, so
  the cookie is sent and CORS doesn't apply.
- JobX's Save is a full-page ASP.NET postback, so the extension persists its
  remaining plan in `chrome.storage.local` and continues on each page load —
  hands-off until every entry is saved. **Stop** cancels the rest.

## The DALI backend contract

`GET /api/timesheets/export` (`dali-api/app/routes/api.timesheets.export.ts`)

| Param | Meaning |
|---|---|
| `hire` | `roleRefId` of a paid role, or `unassigned`. Default: a role with hours. |
| `period` | Any `YYYY-MM-DD` inside a pay period. Default: the role's latest period with hours. |

```json
{
  "timezone": "America/New_York",
  "hireKey": "cm…",
  "hireLabel": "DALI OS Developer",
  "availableHires": [{ "key": "cm…", "label": "DALI OS Developer" }],
  "periodKey": "2026-08-30",
  "periods": [
    { "key": "2026-08-30", "start": "2026-08-30", "end": "2026-09-12",
      "label": "Aug 30 – Sep 12", "hours": 12.5, "entryCount": 6, "current": true }
  ],
  "entries": [
    { "date": "2026-09-01", "start": "14:00", "end": "16:00", "hours": 2, "description": "Sprint planning" }
  ]
}
```

Pay periods are the computed biweekly Sun–Sat fortnights from
`dali-api/app/lib/pay-period.ts` (the same ones the Timesheet tab totals by),
covering the last year. Entry times are wall-clock in your DALI timesheet
zone, which is what JobX's hour/minute/AM-PM selects take.

## Install (developer / sideload)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode** (top-right).
3. **Load unpacked** → select this `jobx-extension/` folder.
4. It talks to production (`https://os.dali.dartmouth.edu`) by default. To
   point it at staging or local dev, click the extension icon → **DALI OS
   server**. The popup also shows whether you're signed in.

## Use

1. Log into DALI OS in the same browser and make sure your Timesheet tab has
   the hours you want.
2. Open the JobX **Manage Time Sheet** page for the open pay period.
3. Click **Fill from DALI**, check the role and pay period, review the
   entries, and click **Fill & save**.
4. Watch the progress pill in the bottom-right. Review the saved entries in
   JobX when it's done, then submit there.

## Notes / limits

- After reloading the extension in `chrome://extensions`, refresh any open
  JobX tab — the old content script loses its connection to the extension.
- A custom server URL has to match one of the manifest's `host_permissions`
  (`localhost:3001/3002/5173` or `*.dali.dartmouth.edu`).
- Blocks that run past midnight are skipped (JobX takes one day per row).
- For non-dev distribution, pack/publish via the Chrome Web Store (or an
  enterprise policy) so members don't need Developer mode.
