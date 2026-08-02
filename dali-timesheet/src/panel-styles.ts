// dali-os design tokens (from the app's style guide) as a self-contained
// stylesheet for the panel's shadow root. `:host { all: initial }` walls the
// panel off from JobX's global CSS so it always reads as dali-os.
export const PANEL_CSS = `
:host {
  all: initial;
  --coral: #FF8B81;
  --coral-soft: #FFA991;
  --teal: #00ADAB;
  --teal-deep: #00807F;
  --navy: #1E5779;
  --ink: #404040;
  --muted: #6B7280;
  --line: #E3E6E8;
  --surface: #FFFFFF;
  --wash: #F1F3F4;
  --radius: 16px;
  --shadow: 0 4px 6px rgba(8, 35, 48, 0.20);
  position: fixed;
  top: 84px;
  right: 20px;
  z-index: 2147483647;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
}
* { box-sizing: border-box; }
.card {
  width: 340px;
  max-height: calc(100vh - 120px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 16px;
  /* Navy chrome grounds the panel and keeps coral reserved for actions in the
     body; the coral keyline is the one "Sunrise" accent. */
  background: linear-gradient(180deg, #1E5779 0%, #17475F 100%);
  border-bottom: 2px solid var(--coral);
  color: #fff;
  cursor: move;
  user-select: none;
}
.head .mark {
  width: 24px; height: 24px; border-radius: 7px;
  background: var(--coral);
  display: grid; place-items: center;
  font-weight: 800; font-size: 13px;
}
.head h1 {
  margin: 0; font-size: 15px; font-weight: 700; letter-spacing: 0.02em;
  font-family: "Dosis", system-ui, sans-serif;
}
.head .close {
  margin-left: auto; background: rgba(255,255,255,0.2); color: #fff;
  width: 24px; height: 24px; border-radius: 7px; font-weight: 700; line-height: 1;
  cursor: pointer;
}
.body {
  padding: 16px; overflow-y: auto;
  display: flex; flex-direction: column; gap: 12px;
}
h2.sec {
  font-size: 13px; font-weight: 700; color: var(--navy); margin: 0;
  font-family: "Dosis", system-ui, sans-serif;
}
.muted { color: var(--muted); font-size: 12px; line-height: 1.5; margin: 0; }
button { font: inherit; cursor: pointer; border: none; border-radius: 10px; }
.btn { padding: 10px 14px; font-size: 13px; font-weight: 700; background: var(--coral); color: #fff; }
.btn:hover { background: var(--coral-soft); }
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.block { width: 100%; }
.btn.ghost { background: transparent; color: var(--navy); border: 1px solid var(--line); }
.btn.ghost:hover { background: var(--wash); }
.code {
  font-family: ui-monospace, monospace; font-size: 22px; font-weight: 800; letter-spacing: 0.18em;
  color: var(--navy); background: var(--wash); border: 1px dashed var(--coral);
  border-radius: 10px; padding: 12px; text-align: center;
}
.row { display: flex; gap: 8px; align-items: center; }
label.field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; font-weight: 600; color: var(--muted); }
select, input, textarea { font: inherit; font-size: 12px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); width: 100%; }
.list { display: flex; flex-direction: column; gap: 8px; }
.entry { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.entry .date { font-weight: 700; font-size: 12px; color: var(--navy); }
.entry.is-added { opacity: 0.7; }
.entry-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.tag.added { background: #E6F7F6; color: var(--teal-deep); }
.tag.warn { background: #FDECD8; color: #B45309; }
.entry-times { display: flex; align-items: center; gap: 6px; }
.entry-times .t { flex: 1; min-width: 0; }
.entry-times .dash { color: var(--muted); flex: 0 0 auto; }
.entry-note { resize: vertical; min-height: 2.2rem; }
.refresh { margin-left: auto; }
.pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: #E6F7F6; color: var(--teal-deep); }
/* The period total sits next to the entry count; tabular figures stop it
   jittering as the number changes between pulls. */
.pill.total { background: var(--teal-deep); color: #fff; font-variant-numeric: tabular-nums; }
.result { display: flex; justify-content: space-between; font-size: 12px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.result .ok { color: var(--teal-deep); font-weight: 600; }
.result .bad { color: #C0392B; font-weight: 600; }
.foot { padding: 10px 16px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; }
.link { background: none; border: none; color: var(--muted); font-size: 11px; text-decoration: underline; padding: 0; cursor: pointer; }
.err { background: #FDECEC; color: #C0392B; border: 1px solid #F5C6C6; border-radius: 10px; padding: 8px 10px; font-size: 12px; }
.center { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 0; text-align: center; }
.spin { width: 18px; height: 18px; border: 2px solid var(--line); border-top-color: var(--coral); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
`;
