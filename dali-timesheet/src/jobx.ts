import type { LoggedEntry, FillOutcome } from "./types";

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

function fillOne(entry: LoggedEntry): FillOutcome {
  const dateKey = localDateKey(entry.startAt);
  const row = locateRow(dateKey);
  if (!row) return { date: dateKey, status: "skipped", detail: "No timesheet row for this date" };

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
  if (!timesSet) return { date: dateKey, status: "error", detail: "Couldn't set the time fields" };

  chooseOption(field("PayCodes1"), "1");
  const note = (entry.description ?? "").trim();
  if (note) writeNote(prefix, suffix, note);

  const save = document.getElementById(field("AddButton"));
  if (!save) return { date: dateKey, status: "error", detail: "Add button not found" };
  (save as HTMLElement).click();
  return { date: dateKey, status: "filled" };
}

/** Fill a role-scoped batch, one row at a time. */
export function fillEntries(entries: LoggedEntry[]): FillOutcome[] {
  return entries.map(fillOne);
}
