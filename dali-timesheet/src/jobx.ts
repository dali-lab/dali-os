import type { LoggedEntry } from "./types";

// Writes logged entries into JobX's quick-add timesheet grid. The grid pairs an
// `addQuickentry` row (a hidden `..._QuickDate_<suffix>` marker plus Start/End/
// PayCode <select>s and an Add button) with an `addQuickNoteentry` row holding
// the note field. We locate each row fresh by its date so the batch survives the
// partial postback JobX fires when a row is added.

interface Clock {
  hour: string;
  minute: string;
  ampm: "AM" | "PM";
}

function toClock(iso: string): Clock {
  const d = new Date(iso);
  const h24 = d.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hour: String(h12),
    minute: d.getMinutes().toString().padStart(2, "0"),
    ampm: h24 < 12 ? "AM" : "PM",
  };
}

/** JobX prints the row's date as "M/D/YYYY ..."; match that exact format. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

/** Find the quick-add row for a date and return the id prefix + suffix that
 *  address every field in it. */
function locateRow(dateKey: string): { prefix: string; suffix: string } | null {
  const markers = document.querySelectorAll<HTMLInputElement>('input[type="hidden"][id*="QuickDate"]');
  for (const marker of Array.from(markers)) {
    if (!marker.value) continue;
    if (marker.value.trim().split(/\s+/)[0] !== dateKey) continue;
    const [prefix, suffix] = marker.id.split("_QuickDate_");
    if (prefix && suffix) return { prefix, suffix };
  }
  return null;
}

/** Select an <option> by value or visible text (case-insensitive). */
function chooseOption(id: string, value: string): boolean {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (!select) return false;
  const want = value.toLowerCase();
  for (const option of Array.from(select.options)) {
    if (option.value.toLowerCase() === want || option.text.trim().toLowerCase() === want) {
      select.selectedIndex = option.index;
      return true;
    }
  }
  return false;
}

/** Put the note into the paired `addQuickNoteentry` row. Best-effort: an
 *  id-addressed note field wins, else the note row's own input/textarea. */
function writeNote(prefix: string, suffix: string, note: string): void {
  const byId = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[id*="${suffix}"][id*="Note" i]`,
  );
  if (byId) {
    byId.value = note;
    return;
  }
  const marker = document.getElementById(`${prefix}_QuickDate_${suffix}`);
  let row = marker?.closest("tr")?.nextElementSibling ?? null;
  while (row instanceof HTMLTableRowElement) {
    if (row.classList.contains("addQuickNoteentry")) {
      const field = row.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "textarea, input[type='text']",
      );
      if (field) field.value = note;
      return;
    }
    if (row.classList.contains("addQuickentry")) return; // next entry — stop
    row = row.nextElementSibling;
  }
}

// Is the quick-add grid present, i.e. can we fill on this page right now?
export function canFill(): boolean {
  return !!document.querySelector("[id*='QuickDate']");
}

export type PrepResult =
  | { ok: true; dateKey: string; prefix: string; suffix: string }
  | { ok: false; dateKey: string; status: "skipped" | "error"; detail: string };

// Populate a row's time/note/pay-code fields WITHOUT clicking Add. Split from
// the commit so the caller can persist the queue before JobX's postback reloads
// the page (clicking Add navigates, which would race an unsaved queue write).
export function prepareRow(entry: LoggedEntry): PrepResult {
  const dateKey = localDateKey(entry.startAt);
  const row = locateRow(dateKey);
  if (!row) return { ok: false, dateKey, status: "skipped", detail: "No timesheet row for this date" };

  const { prefix, suffix } = row;
  const start = toClock(entry.startAt);
  const end = toClock(entry.endAt);
  const field = (name: string) => `${prefix}_${name}_${suffix}`;

  const timesSet =
    chooseOption(field("StartHour1"), start.hour) &&
    chooseOption(field("StartMinute1"), start.minute) &&
    chooseOption(field("StartAmPm1"), start.ampm) &&
    chooseOption(field("EndHour1"), end.hour) &&
    chooseOption(field("EndMinute1"), end.minute) &&
    chooseOption(field("EndAmPm1"), end.ampm);
  if (!timesSet) return { ok: false, dateKey, status: "error", detail: "Couldn't set the time fields" };

  chooseOption(field("PayCodes1"), "1");
  const note = (entry.description ?? "").trim();
  if (note) writeNote(prefix, suffix, note);
  return { ok: true, dateKey, prefix, suffix };
}

// Click a prepared row's Add button. This fires JobX's full-page postback, so
// the queue must already be persisted before calling it.
export function commitRow(prefix: string, suffix: string): boolean {
  const save = document.getElementById(`${prefix}_AddButton_${suffix}`);
  if (!save) return false;
  (save as HTMLElement).click();
  return true;
}

// ── Compare pulled entries against what's already saved on the page ──────────
// "added"    = a saved row matches this date AND start/end → skip on fill.
// "override" = a saved row exists on this date with a different time → the
//              pulled entry supersedes it (delete-then-add, once supported).
// "new"      = nothing saved on that date yet → fill normally.
export type EntryStatus = "new" | "added" | "override";

const longDateLabel = (iso: string) =>
  new Date(iso)
    .toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .toLowerCase();

const timeLabel = (iso: string) => {
  const c = toClock(iso);
  return `${c.hour}:${c.minute} ${c.ampm}`.toLowerCase();
};

// ── Deleting a saved row (for override / "replace existing") ─────────────────
// Heuristic and deliberately conservative: we only look INSIDE the one saved
// "Reg Hours" row for this date, and only click something that self-identifies
// as a delete control — so a wrong guess can't reach an unrelated element. If
// there's more than one saved row on the date, we refuse (ambiguous) rather
// than risk deleting the wrong one.
export type FindDeleteResult =
  | { ok: true; el: HTMLElement }
  | { ok: false; status: "skipped" | "error"; detail: string };

function looksLikeDelete(el: Element): boolean {
  const hay = [
    el.getAttribute("id"),
    el.getAttribute("name"),
    el.getAttribute("title"),
    el.getAttribute("alt"),
    el.getAttribute("aria-label"),
    el.getAttribute("href"),
    el.getAttribute("onclick"),
    (el as HTMLInputElement).value,
    (el as HTMLImageElement).src,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /delete|remove|trash/.test(hay);
}

export function findSavedRowDelete(entry: LoggedEntry): FindDeleteResult {
  const date = longDateLabel(entry.startAt);
  const rows = Array.from(document.querySelectorAll("tr")).filter((r) => {
    const t = (r.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    return t.includes("reg hours") && t.includes(date);
  });
  if (rows.length === 0) return { ok: false, status: "skipped", detail: "No saved row to replace" };
  if (rows.length > 1) {
    return { ok: false, status: "error", detail: "Multiple saved rows on this date — delete manually" };
  }
  const control = Array.from(rows[0].querySelectorAll<HTMLElement>("a, button, input, img")).find(
    looksLikeDelete,
  );
  if (!control) return { ok: false, status: "error", detail: "Couldn't find a delete control in the row" };
  // An <img> delete icon usually sits inside the real clickable target.
  const el = control.tagName === "IMG" ? ((control.closest("a, button, [onclick]") as HTMLElement) ?? control) : control;
  return { ok: true, el };
}

export function classify(entries: LoggedEntry[]): EntryStatus[] {
  // Saved entries render as "Reg Hours" rows; collect their normalized text once.
  const savedRows = Array.from(document.querySelectorAll("tr"))
    .map((r) => (r.textContent || "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((t) => t.includes("reg hours"));

  return entries.map((entry) => {
    const date = longDateLabel(entry.startAt);
    const onDate = savedRows.filter((t) => t.includes(date));
    if (onDate.length === 0) return "new";
    const start = timeLabel(entry.startAt);
    const end = timeLabel(entry.endAt);
    if (onDate.some((t) => t.includes(start) && t.includes(end))) return "added";
    return "override";
  });
}
