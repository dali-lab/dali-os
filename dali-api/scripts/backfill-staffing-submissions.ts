/**
 * Backfill StaffingPreference / IntentToWork rows for project-bids and
 * intent-to-work form submissions that should have produced them but didn't.
 * Two cases are handled:
 *
 *  (A) ORPHANED — the submission was saved with staffingCycleId = null / slot =
 *      null. Before the pickStaffingBinding fix, submitMemberForm derived the
 *      cycle from currentTerm() and only acted on a binding matching the live
 *      cycle, so a submission for a non-live term fell through to the plain
 *      branch and wrote no staffing rows. The cycle is re-derived from the
 *      form's own binding.
 *
 *  (B) STAMPED-BUT-EMPTY — the submission IS stamped with a cycle+slot, but the
 *      member currently has NO StaffingPreference / IntentToWork for that cycle.
 *      This happens when validation dropped every row under the old rules (e.g.
 *      bids on projects with no matching ProjectRoleRequest, before biddability
 *      became domain-driven). Re-running validation under the current rules
 *      recovers them. The cycle is the one already on the row.
 *
 * In both cases we replay the exact interpret → validate → replace path the
 * live code uses, so recovered rows match a fresh submission.
 *
 * SAFETY — never clobbers good data:
 *  - Case B only touches submissions whose member has ZERO existing rows for
 *    the cycle, so there's nothing to overwrite.
 *  - Only the LATEST submission per (user, form) is replayed; older ones are
 *    left (replace-whole-set would otherwise wipe newer data).
 *  - Orphans are also stamped so they drop out of the candidate set on re-run.
 *
 * Dry-run by default — prints what it WOULD do and writes nothing. Pass
 * --commit to actually write.
 *
 * Usage:
 *   npx tsx --env-file .env scripts/backfill-staffing-submissions.ts          # dry run
 *   npx tsx --env-file .env scripts/backfill-staffing-submissions.ts --commit # write
 */
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { interpretBidForm } from "../app/projects/lib/bid-form-interpreter.js";
import { validateBids, replaceBidSet } from "../app/projects/lib/bid-validation.js";
import { interpretIntentForm } from "../app/projects/lib/intent-form-interpreter.js";
import { replaceIntentSet } from "../app/projects/lib/intent-validation.js";
import {
  parseColumnMapping,
  validateMapping,
} from "../app/projects/lib/slot-roles.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const COMMIT = process.argv.includes("--commit");

type Question = Parameters<typeof validateMapping>[1][number];
type Slot = "project-bids" | "intent-to-work";

// One unit of work, normalized so the two source cases share a code path.
type Candidate = {
  id: string;
  userId: string;
  createdAt: Date;
  formId: string;
  formName: string;
  answers: Record<string, unknown>;
  questions: Question[];
  slot: Slot;
  cycle: { id: string; termId: string; maxPreferencesPerMember: number };
  columnMapping: unknown;
  source: "orphan" | "stamped-empty";
};

async function main() {
  console.log(
    COMMIT
      ? "▶ COMMIT mode — changes WILL be written.\n"
      : "▶ DRY RUN — no changes will be written. Re-run with --commit to apply.\n",
  );

  const candidates: Candidate[] = [];
  let skipped = 0;

  // ── Case A: orphaned submissions (null cycle) on a staffing-bound form ──
  const orphans = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: null,
      userId: { not: null },
      form: {
        cycleBindings: { some: { slot: { in: ["project-bids", "intent-to-work"] } } },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      answers: true,
      formVersion: { select: { questions: true } },
      form: {
        select: {
          id: true,
          name: true,
          cycleBindings: {
            where: { slot: { in: ["project-bids", "intent-to-work"] } },
            select: {
              slot: true,
              columnMapping: true,
              staffingCycle: {
                select: { id: true, termId: true, maxPreferencesPerMember: true },
              },
            },
          },
        },
      },
    },
  });

  for (const sub of orphans) {
    const slotBindings = sub.form.cycleBindings.filter(
      (b) => b.slot === "project-bids" || b.slot === "intent-to-work",
    );
    // A form bound to one slot for one cycle is the normal case. If it's bound
    // to a slot for several cycles we can't attribute an orphan answer set;
    // skip for a human rather than guess.
    if (slotBindings.length !== 1) {
      console.log(
        `  ⊘ orphan ${sub.id} (form "${sub.form.name}"): ambiguous — ` +
          `${slotBindings.length} staffing binding(s); skipping.`,
      );
      skipped++;
      continue;
    }
    const b = slotBindings[0];
    candidates.push({
      id: sub.id,
      userId: sub.userId!,
      createdAt: sub.createdAt,
      formId: sub.form.id,
      formName: sub.form.name,
      answers: (sub.answers as Record<string, unknown>) ?? {},
      questions: (sub.formVersion.questions as unknown as Question[]) ?? [],
      slot: b.slot as Slot,
      cycle: b.staffingCycle,
      columnMapping: b.columnMapping,
      source: "orphan",
    });
  }

  // ── Case B: stamped submissions whose member has no rows for that cycle ──
  const stamped = await prisma.formSubmission.findMany({
    where: {
      staffingCycleId: { not: null },
      userId: { not: null },
      slot: { in: ["project-bids", "intent-to-work"] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      slot: true,
      answers: true,
      staffingCycleId: true,
      formVersion: { select: { questions: true } },
      form: {
        select: {
          id: true,
          name: true,
          cycleBindings: {
            select: { slot: true, columnMapping: true, staffingCycle: { select: { id: true } } },
          },
        },
      },
      staffingCycle: {
        select: { id: true, termId: true, maxPreferencesPerMember: true },
      },
    },
  });

  for (const sub of stamped) {
    const slot = sub.slot as Slot;
    const userId = sub.userId!;
    const cycleId = sub.staffingCycleId!;
    // Only re-validate when the member currently has NOTHING for this cycle —
    // that's the "dropped to empty" case. If they already have rows, leave them
    // alone (never clobber good data).
    const existing =
      slot === "project-bids"
        ? await prisma.staffingPreference.count({
            where: { userId, staffingCycleId: cycleId },
          })
        : await prisma.intentToWork.count({
            where: { userId, staffingCycleId: cycleId },
          });
    if (existing > 0) continue;

    // The mapping for a stamped submission comes from the binding on the SAME
    // cycle+slot (that's how the live submit interpreted it).
    const binding = sub.form.cycleBindings.find(
      (cb) => cb.slot === slot && cb.staffingCycle.id === cycleId,
    );
    if (!binding) {
      console.log(
        `  ⊘ stamped ${sub.id} (form "${sub.form.name}", ${slot}): no binding for its own ` +
          `cycle+slot; skipping (can't re-interpret).`,
      );
      skipped++;
      continue;
    }
    candidates.push({
      id: sub.id,
      userId,
      createdAt: sub.createdAt,
      formId: sub.form.id,
      formName: sub.form.name,
      answers: (sub.answers as Record<string, unknown>) ?? {},
      questions: (sub.formVersion.questions as unknown as Question[]) ?? [],
      slot,
      cycle: sub.staffingCycle!,
      columnMapping: binding.columnMapping,
      source: "stamped-empty",
    });
  }

  console.log(
    `Found ${candidates.length} candidate submission(s) ` +
      `(${candidates.filter((c) => c.source === "orphan").length} orphaned, ` +
      `${candidates.filter((c) => c.source === "stamped-empty").length} stamped-but-empty).\n`,
  );

  let recovered = 0;

  // oldest-first within each (user, form) bucket: process so the newest wins.
  candidates.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const c of candidates) {
    // replace*Set is whole-set per (user, cycle), so only the LATEST submission
    // for this (user, form) may write. An older one would wipe newer data.
    const newer = await prisma.formSubmission.findFirst({
      where: { userId: c.userId, formId: c.formId, createdAt: { gt: c.createdAt } },
      select: { id: true },
    });
    if (newer) {
      console.log(
        `  ↩ ${c.source} ${c.id} (form "${c.formName}", ${c.slot}): superseded by a newer ` +
          `submission; ${c.source === "orphan" ? "stamping cycle only" : "leaving as-is"}.`,
      );
      if (COMMIT && c.source === "orphan") {
        await prisma.formSubmission.update({
          where: { id: c.id },
          data: { staffingCycleId: c.cycle.id, slot: c.slot },
        });
      }
      recovered++;
      continue;
    }

    const mapping = parseColumnMapping(c.columnMapping);
    const mapCheck = validateMapping(c.slot, c.questions, mapping);
    if (!mapCheck.ok || mapping == null) {
      const why = mapCheck.ok ? "no mapping" : mapCheck.reason;
      console.log(
        `  ~ ${c.source} ${c.id} (form "${c.formName}", ${c.slot}): mapping not usable (${why}); ` +
          `${c.source === "orphan" ? "stamping cycle only, no staffing rows" : "no rows to recover"}.`,
      );
      if (COMMIT && c.source === "orphan") {
        await prisma.formSubmission.update({
          where: { id: c.id },
          data: { staffingCycleId: c.cycle.id, slot: c.slot },
        });
      }
      recovered++;
      continue;
    }

    if (c.slot === "project-bids") {
      const interpreted = interpretBidForm(c.answers, mapping);
      const rawBids = interpreted.ok ? interpreted.bids : [];
      const validated =
        rawBids.length > 0
          ? await validateBids(c.userId, c.cycle, rawBids)
          : { ok: true as const, bids: [] };
      const bids = validated.ok ? validated.bids : [];

      console.log(
        `  ✓ ${c.source} ${c.id} (form "${c.formName}", project-bids → ${c.cycle.id}): ` +
          `${bids.length} preference row(s) for user ${c.userId}.`,
      );
      if (COMMIT) {
        await prisma.$transaction(async (tx) => {
          await replaceBidSet(tx, c.userId, c.cycle.id, bids);
          await tx.formSubmission.update({
            where: { id: c.id },
            data: { staffingCycleId: c.cycle.id, slot: "project-bids" },
          });
        });
      }
      recovered++;
    } else {
      const termRows = await prisma.term.findMany({ select: { id: true } });
      const interpreted = interpretIntentForm(
        c.answers,
        mapping,
        termRows.map((t) => t.id),
      );
      const rows = interpreted.ok ? interpreted.rows : [];

      console.log(
        `  ✓ ${c.source} ${c.id} (form "${c.formName}", intent-to-work → ${c.cycle.id}): ` +
          `${rows.length} intent row(s) for user ${c.userId}.`,
      );
      if (COMMIT) {
        await prisma.$transaction(async (tx) => {
          await replaceIntentSet(tx, c.userId, c.cycle.id, rows);
          await tx.formSubmission.update({
            where: { id: c.id },
            data: { staffingCycleId: c.cycle.id, slot: "intent-to-work" },
          });
        });
      }
      recovered++;
    }
  }

  console.log(
    `\nDone. ${recovered} submission(s) ${COMMIT ? "processed" : "would be processed"}, ` +
      `${skipped} skipped (ambiguous / no binding).`,
  );
  if (!COMMIT && recovered > 0) {
    console.log("Re-run with --commit to apply.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
