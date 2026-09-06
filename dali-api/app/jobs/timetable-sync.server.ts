// Pre-syncs the Dartmouth public timetable into CourseOffering so the class
// composer can autofill title / period / location from a picked section.
//
// One POST per term returns that term's whole catalog (~1,300 sections), so a
// run is a handful of large requests, not one-per-subject. Each term is replaced
// atomically (delete + bulk insert) — that upserts adds, drops cancelled
// sections, and is idempotent. Only current + upcoming terms are synced (what
// the composer offers); past terms are left untouched. A fetch that fails or
// comes back empty leaves the term's existing rows in place, so a registrar
// format change degrades to "0 upserted" rather than wiping the catalog.

import type { JobContext, JobResult } from "~/jobs/registry";
import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { dartmouthTermCode, daliTermCodeFromDartmouth } from "~/lib/terms.shared";
import { fetchTermCatalog } from "~/lib/dartmouth-timetable.server";
import { formatCourseLocation } from "~/calendar/lib/class-format";
import { notify } from "~/lib/notify.server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type OfferingSnapshot = { periodCode: string | null; building: string | null; room: string | null };
type FreshRow = OfferingSnapshot & { crn: string; subject: string; number: string };

// Alert members whose saved class's section changed time/room in this sync. Diffs
// the section's old vs new state (offering-vs-offering, so a member's manual edits
// never trigger a false alert). The dedupKey is keyed to the NEW state, so a repeat
// sync doesn't re-alert until the section changes again.
async function notifyClassChanges(
  termId: string,
  freshRows: FreshRow[],
  oldByCrn: Map<string, OfferingSnapshot>,
): Promise<number> {
  const freshByCrn = new Map(freshRows.map((r) => [r.crn, r]));
  const changedCrns = freshRows
    .filter((r) => {
      const old = oldByCrn.get(r.crn);
      return (
        old && (old.periodCode !== r.periodCode || old.building !== r.building || old.room !== r.room)
      );
    })
    .map((r) => r.crn);
  if (changedCrns.length === 0) return 0;

  const classes = await prisma.memberClass.findMany({
    where: { termId, offeringCrn: { in: changedCrns } },
    select: { id: true, userId: true, title: true, offeringCrn: true },
  });

  let sent = 0;
  for (const cls of classes) {
    const fresh = cls.offeringCrn ? freshByCrn.get(cls.offeringCrn) : undefined;
    const old = cls.offeringCrn ? oldByCrn.get(cls.offeringCrn) : undefined;
    if (!fresh || !old) continue;
    const newLoc = formatCourseLocation({ building: fresh.building, room: fresh.room });
    const oldLoc = formatCourseLocation({ building: old.building, room: old.room });
    const parts: string[] = [];
    if (old.periodCode !== fresh.periodCode)
      parts.push(`period ${old.periodCode || "—"} → ${fresh.periodCode || "—"}`);
    if (oldLoc !== newLoc) parts.push(`${oldLoc || "no room"} → ${newLoc || "no room"}`);
    await notify({
      eventType: "class.schedule_changed",
      message: {
        title: `${cls.title} schedule changed`,
        body: `${parts.join("; ")}. Open your calendar to update it.`,
        link: "/calendar",
        dedupKey: `class-change:${cls.id}:${fresh.periodCode ?? ""}:${newLoc}`,
      },
      recipients: [{ userId: cls.userId }],
    });
    sent += 1;
  }
  return sent;
}

export async function runTimetableSync(ctx: JobContext): Promise<JobResult> {
  const maxTerms = ctx.settings.maxTermsPerRun;
  const spacingMs = ctx.settings.requestSpacingMs;

  const current = await currentTerm();
  if (!current) return { items: 0, note: "no current term" };

  // Current + upcoming terms (the set the composer offers), so we never fetch a
  // term nobody can add classes to.
  const terms = await prisma.term.findMany({
    where: { sortKey: { gte: current.sortKey } },
    orderBy: { sortKey: "asc" },
    select: { id: true, code: true },
  });
  if (terms.length === 0) return { items: 0, note: "no current/upcoming terms" };

  // Walk stalest-first so a capped run rotates through terms across ticks.
  const freshness = await prisma.courseOffering.groupBy({
    by: ["termId"],
    _max: { syncedAt: true },
  });
  const lastSync = new Map(freshness.map((f) => [f.termId, f._max.syncedAt?.getTime() ?? 0]));
  const ordered = [...terms].sort((a, b) => (lastSync.get(a.id) ?? 0) - (lastSync.get(b.id) ?? 0));
  const batch = ordered.slice(0, maxTerms);

  let upserted = 0;
  let synced = 0;
  let failed = 0;
  let changed = 0;

  for (let i = 0; i < batch.length; i += 1) {
    const term = batch[i];
    const oracleCode = dartmouthTermCode(term.code);
    if (!oracleCode) continue; // not a Dartmouth term code (defensive)

    try {
      if (i > 0 && spacingMs > 0) await sleep(spacingMs);
      const courses = await fetchTermCatalog(oracleCode);

      // Dedupe cross-listed sections that share a CRN within the term (the unique
      // (termId, crn) key would otherwise reject the bulk insert).
      const byCrn = new Map<string, (typeof courses)[number]>();
      for (const c of courses) {
        if (!c.crn) continue;
        if (daliTermCodeFromDartmouth(c.term) !== term.code) continue; // stray row guard
        byCrn.set(c.crn, c);
      }

      const rows = [...byCrn.values()].map((c) => ({
        termId: term.id,
        oracleTerm: oracleCode,
        crn: c.crn,
        subject: c.subject,
        number: c.number,
        section: c.section,
        title: c.title,
        periodCode: c.periodCode || null,
        periodText: c.periodText || null,
        building: c.building || null,
        room: c.room || null,
        instructor: c.instructor || null,
        crosslist: c.crosslist || null,
        distributive: c.distributive || null,
        enrollLimit: c.enrollLimit,
        enrollCurrent: c.enrollCurrent,
        searchText: `${c.subject} ${c.number} ${c.title}`.toLowerCase(),
        syncedAt: ctx.now,
      }));

      // An empty parse means a bad fetch / format drift — keep the old rows.
      if (rows.length === 0) {
        failed += 1;
        console.error(`[timetable-sync] ${term.code} (${oracleCode}) returned no rows`);
        continue;
      }

      // Snapshot the current sections (pre-replace) so we can alert members whose
      // saved class's time/room changed.
      const oldByCrn = new Map(
        (
          await prisma.courseOffering.findMany({
            where: { termId: term.id },
            select: { crn: true, periodCode: true, building: true, room: true },
          })
        ).map((o) => [o.crn, { periodCode: o.periodCode, building: o.building, room: o.room }]),
      );

      // Replace the term's catalog atomically.
      await prisma.$transaction([
        prisma.courseOffering.deleteMany({ where: { termId: term.id } }),
        prisma.courseOffering.createMany({ data: rows }),
      ]);
      upserted += rows.length;
      synced += 1;
      changed += await notifyClassChanges(term.id, rows, oldByCrn);
    } catch (err) {
      failed += 1;
      console.error(`[timetable-sync] ${term.code} (${oracleCode}) failed`, err);
    }
  }

  const deferred = ordered.length - batch.length;
  return {
    items: upserted,
    note:
      `${synced}/${batch.length} term${batch.length === 1 ? "" : "s"} synced` +
      (changed > 0 ? `, ${changed} change alert${changed === 1 ? "" : "s"}` : "") +
      (failed > 0 ? `, ${failed} failed` : "") +
      (deferred > 0 ? `, ${deferred} deferred` : ""),
  };
}
