import { prisma } from "~/lib/db";

// Staffing is always open: exactly one StaffingCycle per term (enforced by
// StaffingCycle.termId @unique), auto-created the first time that term's
// staffing surface is viewed. This is the single source of that invariant —
// the staffing board and the Intent-to-Work / Project-Bids forms all go
// through here so the "get-or-create, named `<code> Staffing`" rule lives in
// one place.
//
// findUnique-then-create (not upsert): the steady state is a pure read. The
// create fires at most once per term ever; the @unique constraint makes a
// concurrent double-create safe (the loser hits P2002, and we re-read).
export async function ensureStaffingCycle(termId: string, termCode: string) {
  const existing = await prisma.staffingCycle.findUnique({
    where: { termId },
  });
  if (existing) return existing;

  try {
    return await prisma.staffingCycle.create({
      data: { termId, name: `${termCode} Staffing` },
    });
  } catch (e) {
    // Lost a create race — the row now exists; read it back.
    if ((e as { code?: string })?.code === "P2002") {
      const row = await prisma.staffingCycle.findUnique({ where: { termId } });
      if (row) return row;
    }
    throw e;
  }
}
