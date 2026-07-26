# DALI Timesheet

A small Chrome extension that fills your **JobX** timesheet from the hours you've
already logged in **DALI OS**. It attaches a dali-os-styled panel directly to the
JobX timesheet page — no side panel, no re-typing.

## How it works

1. **Connect** — approve once in DALI OS (the same device-pairing flow the
   desktop app uses). A long-lived token is stored locally; no separate password.
2. **Pull** — the panel fetches your logged entries from
   `GET /api/timesheets/export` (last 30 days).
3. **Pick a role** — entries are grouped per paid role/job. Choose one.
4. **Fill** — the panel writes that role's entries into the JobX quick-add grid
   (date, start/end time, note, pay code). Because the export is per-role, the
   fill only ever touches the selected role's timesheet — nothing lands on the
   wrong one. Review the rows in JobX and submit them there.

## Architecture

Deliberately lean and framework-free:

- `src/background.ts` — service worker. Owns the DALI token and all network
  (pairing + export). The panel never touches the token or fetches directly.
- `src/content.ts` + `src/panel.ts` — a **Shadow-DOM** panel injected on the
  JobX page, styled with dali-os design tokens (`src/panel-styles.ts`) and
  isolated from JobX's CSS.
- `src/jobx.ts` — locates each quick-add row by date and fills it, including the
  paired note row.
- `src/dali-api.ts` / `src/messages.ts` — typed DALI client + the panel↔worker
  message protocol.

This is original code. The only things it reuses are DALI OS's own building
blocks: the `/auth/pair/*` and `/api/timesheets/export` endpoints, and the
published design tokens.

## Develop

```bash
npm install
npm run build      # → dist/
npm run watch      # rebuild on change
npm run typecheck
```

Then load `dist/` at `chrome://extensions` → Developer mode → **Load unpacked**.
Open a JobX timesheet page; the panel appears (or click the toolbar icon to
toggle it).

Point at a local DALI instance by setting `DALI_ORIGIN` at build time (see
`src/config.ts`); production is the default.

## Notes

- Branded PNG icons aren't included yet — the manifest uses Chrome's default
  action icon. Drop `icons/16,32,48,128.png` in and add an `icons` block +
  `action.default_icon` to `manifest.json` to brand it.
- The JobX field ids (`Skin_body_ctl01_StartHour1_<suffix>`, the
  `addQuickNoteentry` note row) are read defensively, but JobX is a third-party
  page — smoke-test the fill after any JobX redesign.
