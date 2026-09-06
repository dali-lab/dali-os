// Shared writes into the CourseOffering cache: the row shape (used by both the
// scheduled term sync and the on-demand per-subject refresh) and a live
// single-subject refresh for keeping volatile data (seats) current on demand.

import { prisma } from "~/lib/db";
import { dartmouthTermCode, daliTermCodeFromDartmouth } from "~/lib/terms.shared";
import { fetchSubjectCatalog, type OracleCourse } from "~/lib/dartmouth-timetable.server";

/** Map a parsed Oracle course to a CourseOffering row. One shape everywhere. */
export function toOfferingRow(termId: string, oracleTerm: string, c: OracleCourse, syncedAt: Date) {
  return {
    termId,
    oracleTerm,
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
    syncedAt,
  };
}

/** Live-refresh one subject's sections for a term (replaces just that subject's
 *  cached rows). Returns the number of sections written; 0 (rows untouched) when
 *  the term/subject can't be resolved or the fetch comes back empty. */
export async function refreshSubjectOfferings(termId: string, subject: string): Promise<number> {
  const subj = subject.trim().toUpperCase();
  if (!subj) return 0;
  const term = await prisma.term.findUnique({ where: { id: termId }, select: { code: true } });
  if (!term) return 0;
  const oracleTerm = dartmouthTermCode(term.code);
  if (!oracleTerm) return 0;

  const courses = await fetchSubjectCatalog(oracleTerm, subj);
  const now = new Date();
  const byCrn = new Map<string, OracleCourse>();
  for (const c of courses) {
    if (!c.crn || c.subject.toUpperCase() !== subj) continue;
    if (daliTermCodeFromDartmouth(c.term) !== term.code) continue; // stray-row guard
    byCrn.set(c.crn, c);
  }
  const rows = [...byCrn.values()].map((c) => toOfferingRow(termId, oracleTerm, c, now));
  if (rows.length === 0) return 0; // don't wipe a subject on an empty/failed fetch

  await prisma.$transaction([
    prisma.courseOffering.deleteMany({ where: { termId, subject: subj } }),
    prisma.courseOffering.createMany({ data: rows }),
  ]);
  return rows.length;
}
