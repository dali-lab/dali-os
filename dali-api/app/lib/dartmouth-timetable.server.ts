// Client for Dartmouth's public Oracle timetable (the Registrar's PL/SQL web
// app). One POST to `timetable.display_courses` with `subjectradio=allsubjects`
// returns the ENTIRE term catalog (~1,300 sections) in a single ~2 MB response,
// so a term syncs in one request rather than one-per-subject.
//
// The response HTML is malformed: every row cell can wrap a nested
// <html><head><script>…</script></head><body>…</body></html> tooltip block, and
// empty cells are emitted as bare "&nbsp" (no semicolon). We strip the nested
// wrappers, pull the <div class="data-table"> block, split it into <td> cells,
// and regroup into rows at each 6-digit term-code cell — a regex port of the
// reference BeautifulSoup implementation (no HTML-parser dependency).
//
// Column layout of the all-subjects response (22 cells; note the extra status
// flag at index 5 that the single-subject view lacks):
//   0 term  1 crn  2 subject(a)  3 number  4 section  5 flag  6 title(a)
//   7 icon  8 crosslist  9 periodCode(a)  10 periodText(a)  11 room
//   12 building  13 instructor  14 worldCulture  15 distributive
//   16 langReq  17 enrollLimit  18 enrollCurrent  19 status

import { normalizeCourseNumber } from "~/calendar/lib/class-format";

const BASE_URL = "https://oracle-www.dartmouth.edu/dart/groucho";
const REQUEST_TIMEOUT_MS = 30_000;

// Hidden form fields the Oracle app expects on every search; dropping any of
// them yields an empty results page.
const HIDDEN_DEFAULTS: [string, string][] = [
  ["classyear", "2008"],
  ["pmode", "public"],
  ["term", ""],
  ["levl", ""],
  ["fys", "n"],
  ["wrt", "n"],
  ["pe", "n"],
  ["review", "n"],
  ["crnl", "no_value"],
];

export type OracleCourse = {
  term: string; // "202609"
  crn: string;
  subject: string; // "COSC"
  number: string; // normalized: "52", not "052"
  section: string; // "01"
  title: string;
  crosslist: string;
  periodCode: string; // "10","2A"…; "ARR" or "" when unscheduled
  periodText: string; // "MWF 2:10-3:15, Th 1:20-2:10"
  room: string;
  building: string;
  instructor: string;
  worldCulture: string;
  distributive: string;
  enrollLimit: number | null;
  enrollCurrent: number | null;
  status: string;
};

/** Fetch + parse the full catalog for a Dartmouth term code ("202609"). */
export async function fetchTermCatalog(
  termCode: string,
  signal?: AbortSignal,
): Promise<OracleCourse[]> {
  const body = new URLSearchParams([
    ["distribradio", "alldistribs"],
    ["subjectradio", "allsubjects"],
    ["depts", "no_value"],
    ["periods", "no_value"],
    ["distribs", "no_value"],
    ["distribs_i", "no_value"],
    ["distribs_wc", "no_value"],
    ["distribs_lang", "no_value"],
    ["deliveryradio", "alldelivery"],
    ["deliverymodes", "no_value"],
    ["searchtype", "Subject Area(s)"],
    ["termradio", "selectterms"],
    ["terms", "no_value"],
    ["terms", termCode],
    ["hoursradio", "allhours"],
    ["sortorder", "dept"],
    ...HIDDEN_DEFAULTS,
  ]);

  const res = await fetch(`${BASE_URL}/timetable.display_courses`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "DALI-OS timetable-sync (dalios@dali.dartmouth.edu)",
    },
    body,
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Dartmouth timetable returned ${res.status}`);
  return parseCourses(await res.text());
}

type CellPart = { plain: string; link: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;?/gi, " ") // Oracle emits bare "&nbsp" for empty cells
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/ /g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function cellParts(cellHtml: string): CellPart {
  const a = cellHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  return { plain: stripTags(cellHtml), link: a ? stripTags(a[1]) : "" };
}

const isTermCode = (s: string) => /^\d{6}$/.test(s);
// A row is complete enough to keep once it has this many cells (the reference's
// boundary; real rows carry 22).
const MIN_ROW_CELLS = 15;

export function parseCourses(html: string): OracleCourse[] {
  const cleaned = html
    .replace(/<html>\s*<head>\s*<script[\s\S]*?<\/script>\s*<\/head>\s*<body>/gi, "")
    .replace(/<\/body>\s*<\/html>/gi, "");

  const table = cleaned.match(/<div class="data-table">([\s\S]*?)(?:<\/div>|$)/i);
  if (!table) return [];

  const cells = [...table[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellParts(m[1]));

  // Regroup the flat cell stream into rows: each row starts at a 6-digit term-code cell.
  const rows: CellPart[][] = [];
  let cur: CellPart[] = [];
  for (const c of cells) {
    if (isTermCode(c.plain)) {
      if (cur.length >= MIN_ROW_CELLS) rows.push(cur);
      cur = [c];
    } else {
      cur.push(c);
    }
  }
  if (cur.length >= MIN_ROW_CELLS) rows.push(cur);

  const out: OracleCourse[] = [];
  for (const r of rows) {
    const plain = (i: number) => (i < r.length ? r[i].plain : "");
    const linked = (i: number) => (i < r.length ? r[i].link || r[i].plain : "");
    const int = (i: number) => {
      const n = Number.parseInt(plain(i), 10);
      return Number.isFinite(n) ? n : null;
    };
    const term = plain(0);
    if (!isTermCode(term)) continue;
    out.push({
      term,
      crn: plain(1),
      subject: linked(2),
      number: normalizeCourseNumber(plain(3)),
      section: plain(4),
      title: linked(6),
      crosslist: plain(8),
      periodCode: linked(9),
      periodText: linked(10),
      room: plain(11),
      building: plain(12),
      instructor: plain(13),
      worldCulture: plain(14),
      distributive: plain(15),
      enrollLimit: int(17),
      enrollCurrent: int(18),
      status: plain(19),
    });
  }
  return out;
}
