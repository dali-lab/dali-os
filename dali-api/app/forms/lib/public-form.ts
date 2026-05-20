// Token-addressed access to a *published* form, for the authenticated member
// fill route at /forms/fill/:token and its submit endpoint
// /api/forms/fill/:token. The submitter is always the session user (no
// name/email capture). Kept separate from forms-data.ts (which is staff-only)
// so the fill surface stays small and auditable.

import { prisma } from "~/lib/db";
import type { Question } from "~/types";
import { resolveReferenceOptions } from "./reference-sources";
import { currentTerm } from "~/lib/roles";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { interpretBidForm } from "~/projects/lib/bid-form-interpreter";
import { validateBids, replaceBidSet } from "~/projects/lib/bid-validation";
import { interpretIntentForm } from "~/projects/lib/intent-form-interpreter";
import { replaceIntentSet } from "~/projects/lib/intent-validation";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import type { Slot } from "~/projects/lib/form-slots";

export type PublicForm = {
  formId: string;
  name: string;
  versionId: string;
  description: unknown;
  // `file` questions need an authenticated upload presign, so they're not
  // fillable anonymously — they're returned but flagged unsupported and the
  // UI renders them disabled. Required file questions are reported so we can
  // surface "this form can't be completed publicly" rather than silently drop.
  questions: Question[];
};

function safeParse(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Resolve a public token to its form's latest version. Returns null when the
// token is unknown, the form is unpublished, or it has no versions yet —
// callers must treat all three as an indistinguishable 404 (don't leak which).
// `userId`, when given, is the authenticated member viewing the form. It's
// passed to reference-source resolution so member-scoped sources (e.g.
// "domains:my-eligibility") can populate. On the public/unauthenticated path
// it's absent and those sources resolve to an empty option list.
export async function loadPublicForm(
  token: string,
  userId?: string | null,
): Promise<PublicForm | null> {
  if (!token) return null;
  const form = await prisma.form.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      published: true,
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { id: true, questions: true, intro: true },
      },
    },
  });
  if (!form || !form.published) return null;
  const version = form.versions[0];
  if (!version) return null;

  const questions = (version.questions as unknown as Question[]) ?? [];

  // `reference` questions store only a source key; resolve the live choices
  // now so the fill UI can render them. Done in parallel; non-reference
  // questions pass through untouched.
  const resolved = await Promise.all(
    questions.map(async (q) => {
      if (q.type !== "reference") return q;
      const options = await resolveReferenceOptions(q.data.referenceSource, {
        userId,
      });
      return { ...q, data: { ...q.data, referenceOptions: options } };
    }),
  );

  return {
    formId: form.id,
    name: form.name,
    versionId: version.id,
    description: safeParse(version.intro),
    questions: resolved,
  };
}

// Shared answer validation for the authenticated member submit path.
// Returns an error result, or null when the answers are valid.
async function validateAnswers(
  questions: Question[],
  answers: Record<string, unknown>,
  userId: string,
): Promise<{ error: string; status: number } | null> {
  // Enforce required answers. `file` questions can't be completed without an
  // authenticated upload presign, so a required file question makes the form
  // unsubmittable here — say so explicitly instead of rejecting an otherwise
  // -complete submission.
  for (const q of questions) {
    if (!q.required) continue;
    if (q.type === "file") {
      return {
        error: "This form has a required file upload and can't be submitted here.",
        status: 422,
      };
    }
    const v = answers[q.key];
    const empty =
      v == null ||
      v === "" ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);
    if (empty) return { error: `"${q.data.label}" is required.`, status: 400 };
  }

  // Re-resolve `reference` questions server-side and reject any answer that
  // isn't a currently-valid option. Never trust the client's option list —
  // the source may have changed since the form was rendered.
  for (const q of questions) {
    if (q.type !== "reference") continue;
    const answer = answers[q.key];
    if (answer == null || answer === "") continue; // required-ness handled above
    const options = await resolveReferenceOptions(q.data.referenceSource, {
      userId,
    });
    if (!options.some((o) => o.value === answer)) {
      return {
        error: `"${q.data.label}": that choice is no longer available.`,
        status: 400,
      };
    }
  }
  return null;
}

export type MemberSubmitResult =
  | { ok: true }
  | { error: string; status: number };

// Authenticated member submit. Unlike the public path this has a trustworthy
// `userId`, which is what makes form-driven Project Bids possible: when the
// form is bound to a staffing cycle's "project-bids" slot, the answers are
// interpreted into StaffingPreference rows for THIS member (level resolved
// from their DomainEligibility) in the same transaction as the submission.
//
// Hard gate: if the form is a project-bids form and interpretation/validation
// fails, nothing is written and the member sees the reason — matching the
// existing api.project-bids.ts behaviour. A non-slot form just records the
// submission like the public path (but attributed to the member).
export async function submitMemberForm(args: {
  token: string;
  versionId: string;
  userId: string;
  answers: Record<string, unknown>;
}): Promise<MemberSubmitResult> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: {
      id: true,
      published: true,
      versions: {
        where: { id: args.versionId },
        select: { id: true, questions: true },
      },
      // Slot bindings tell us if this form drives a staffing flow. Resolved
      // server-side from the binding table — never trusted from the client.
      cycleBindings: {
        select: {
          slot: true,
          columnMapping: true,
          staffingCycle: {
            select: { id: true, termId: true, maxPreferencesPerMember: true },
          },
        },
      },
    },
  });
  if (!form) {
    return { error: "Form not found for this link.", status: 404 };
  }
  if (!form.published) {
    return {
      error: "This form isn't published — ask a staffing manager to publish it in Forms.",
      status: 404,
    };
  }
  // loadPublicForm hands back the LATEST version's id; if the form was
  // re-versioned between loading the page and submitting, that id is now
  // stale. Fall back to the latest version rather than hard-failing.
  let version = form.versions[0];
  if (!version) {
    const latest = await prisma.formVersion.findFirst({
      where: { formId: form.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true, questions: true },
    });
    if (!latest) {
      return { error: "This form has no questions yet.", status: 404 };
    }
    version = latest;
  }

  const questions = (version.questions as unknown as Question[]) ?? [];
  const bad = await validateAnswers(questions, args.answers, args.userId);
  if (bad) return bad;

  // Is this form bound to a staffing slot for the *current* term's cycle?
  // The binding rows list every cycle it's bound to; we only act on the live
  // cycle so a stale binding to an old term doesn't fire.
  const term = await currentTerm();
  const liveCycle = term
    ? await ensureStaffingCycle(term.id, term.code)
    : null;
  const staffingBinding = form.cycleBindings.find(
    (b) =>
      (b.slot === "project-bids" || b.slot === "intent-to-work") &&
      liveCycle != null &&
      b.staffingCycle.id === liveCycle.id,
  );

  if (!staffingBinding) {
    // Ordinary member submission — record it, attributed to the member, and
    // close any "todo" notification that pointed them at this form so the
    // Home banner / Tasks count clears.
    await prisma.$transaction(async (tx) => {
      await tx.formSubmission.create({
        data: {
          formId: form.id,
          formVersionId: version.id,
          userId: args.userId,
          answers: args.answers as object,
        },
      });
      await closeFormTodos(tx, args.userId, form.id);
    });
    return { ok: true };
  }

  // A bound staffing form ALWAYS records its raw submission — the slot's
  // board is a database view of submissions, not a fixed-shape record. The
  // saved column mapping is additive: when project/domain (or intent-status)
  // columns are mapped, those answers ALSO feed StaffingPreference /
  // IntentToWork so existing staffing logic stays fed. A missing, partial, or
  // since-broken mapping no longer rejects the member — it just produces no
  // staffing rows for this submission.
  const slot = staffingBinding.slot as Slot;
  const cycle = staffingBinding.staffingCycle;
  const mapping = parseColumnMapping(staffingBinding.columnMapping);
  const mapCheck = validateMapping(slot, questions, mapping);
  // A genuinely broken mapping (wrong question type, stale key) can't be
  // interpreted, but the submission still belongs in the database — record it
  // and skip the staffing feed rather than losing the member's answers.
  const feedStaffing = mapCheck.ok && mapping != null;

  if (slot === "project-bids") {
    const interpreted = feedStaffing
      ? interpretBidForm(args.answers, mapping as ColumnMapping)
      : { ok: true as const, bids: [] };
    // interpretBidForm no longer hard-fails; on the unexpected error shape
    // just skip the feed rather than reject the submission.
    const rawBids = interpreted.ok ? interpreted.bids : [];
    // validateBids resolves level from DomainEligibility and drops bids the
    // member isn't eligible for. Under the database model an eligibility
    // mismatch shouldn't discard the whole submission, so on failure we
    // record with no preference rows instead of erroring.
    const validated =
      rawBids.length > 0
        ? await validateBids(args.userId, cycle, rawBids)
        : { ok: true as const, bids: [] };
    const bidsToWrite = validated.ok ? validated.bids : [];

    await prisma.$transaction(async (tx) => {
      await tx.formSubmission.create({
        data: {
          formId: form.id,
          formVersionId: version.id,
          userId: args.userId,
          staffingCycleId: cycle.id,
          slot: "project-bids",
          answers: args.answers as object,
        },
      });
      // Replace (not merge) so a resubmission with fewer bids removes the
      // old ones; an empty set clears them, matching prior behaviour.
      await replaceBidSet(tx, args.userId, cycle.id, bidsToWrite);
      await closeFormTodos(tx, args.userId, form.id);
    });
    return { ok: true };
  }

  // slot === "intent-to-work": one IntentToWork row per mapped term, when the
  // intent-status columns are mapped. Otherwise the submission is still
  // recorded with no intent rows.
  const termRows = await prisma.term.findMany({ select: { id: true } });
  const interpreted = feedStaffing
    ? interpretIntentForm(
        args.answers,
        mapping as ColumnMapping,
        termRows.map((t) => t.id),
      )
    : { ok: true as const, rows: [] };
  const intentRows = interpreted.ok ? interpreted.rows : [];

  await prisma.$transaction(async (tx) => {
    await tx.formSubmission.create({
      data: {
        formId: form.id,
        formVersionId: version.id,
        userId: args.userId,
        staffingCycleId: cycle.id,
        slot: "intent-to-work",
        answers: args.answers as object,
      },
    });
    await replaceIntentSet(tx, args.userId, cycle.id, intentRows);
    await closeFormTodos(tx, args.userId, form.id);
  });
  return { ok: true };
}

// Mark the member's open announcement-todo notifications that pointed at this
// form as read. That's exactly the "open task" predicate listOpenTasks /
// countOpenTasks use (kind SystemAnnouncement, isTodo, readAt null), so once
// these flip the Home banner item disappears and the sidebar count drops.
async function closeFormTodos(
  tx: Pick<typeof prisma, "notification">,
  userId: string,
  formId: string,
): Promise<void> {
  await tx.notification.updateMany({
    where: {
      recipientUserId: userId,
      kind: "SystemAnnouncement",
      isTodo: true,
      readAt: null,
      formId,
    },
    data: { readAt: new Date() },
  });
}
