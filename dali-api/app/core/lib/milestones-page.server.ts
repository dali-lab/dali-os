import { prisma } from "~/lib/db.server";
import { nextTermCode } from "~/lib/terms.shared";
import { currentTerm } from "~/lib/roles";
import { currentTermWeek, termLabel } from "~/core/lib/milestones";
import { getTermMilestones, listCoreMembersForTerm } from "~/core/lib/milestones.server";

const DAY_MS = 86_400_000;
const utcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

const SEASON_BY_LETTER: Record<string, string> = { W: "W", S: "S", X: "X", F: "F" };

export function parseTermCode(code: string): { season: string; year: number } | null {
  const m = /^(\d{2})([WSXF])$/.exec(code.trim().toUpperCase());
  return m ? { season: SEASON_BY_LETTER[m[2]], year: 2000 + Number(m[1]) } : null;
}

export function parseWeekParam(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 10 ? n : null;
}

export async function loadMilestonesPage(request: Request, todayUtcMs: number) {
  const url = new URL(request.url);
  const codeParam = url.searchParams.get("term")?.trim().toUpperCase() ?? "";
  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "asc" },
    select: { id: true, code: true, year: true, season: true, startDate: true, endDate: true },
  });
  const termList = terms.map((t) => ({
    id: t.id,
    code: t.code,
    label: termLabel(t),
    startMs: utcDay(t.startDate.getTime()),
    endMs: utcDay(t.endDate.getTime()),
  }));

  let term = codeParam ? terms.find((t) => t.code === codeParam) : undefined;
  if (!term && !codeParam) {
    const current = await currentTerm(request);
    term = terms.find((t) => t.id === current?.id) ?? terms[terms.length - 1];
  }
  if (!term) {
    const parsed = parseTermCode(codeParam);
    const last = terms[terms.length - 1];
    const fallback = parsed ?? (last ? parseTermCode(nextTermCode(last.code)) : null);
    return {
      terms: termList,
      term: null,
      missingLabel: fallback ? termLabel(fallback) : "That term",
      prevCode: last?.code ?? null,
    };
  }

  const idx = terms.findIndex((t) => t.id === term.id);
  const startMs = utcDay(term.startDate.getTime());
  const [{ items, lastYear, lastYearItems }, members] = await Promise.all([
    getTermMilestones(term.id),
    listCoreMembersForTerm(term.id),
  ]);
  const currentWeek = currentTermWeek(todayUtcMs, startMs);
  const weekParam = parseWeekParam(url.searchParams.get("week"));
  const lastYearTerm = lastYear ? terms.find((t) => t.id === lastYear.id) : null;
  return {
    terms: termList,
    term: termList[idx],
    prevCode: idx > 0 ? terms[idx - 1].code : null,
    nextCode: idx < terms.length - 1 ? terms[idx + 1].code : nextTermCode(term.code) || null,
    nextExists: idx < terms.length - 1,
    items,
    members,
    currentWeek,
    selectedWeek: weekParam ?? currentWeek ?? 0,
    lastYear: lastYearTerm ? { code: lastYearTerm.code, label: termLabel(lastYearTerm) } : null,
    lastYearItems,
    missingLabel: null,
  };
}
