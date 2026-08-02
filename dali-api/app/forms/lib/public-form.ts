// Token-addressed access to a *published* form, for the authenticated member
// fill route at /forms/fill/:token and its submit endpoint
// /api/forms/fill/:token. The submitter is always the session user (no
// name/email capture). Kept separate from forms-data.ts (which is staff-only)
// so the fill surface stays small and auditable.

import { prisma } from "~/lib/db";
import type { FormAudience } from "~/generated/prisma/client";
import type { Question } from "~/types";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { normalizeQuestionBodies } from "~/lib/question-blocks.server";
import { resolveReferenceOptions } from "./reference-sources";
import { safeParseJsonString } from "./forms-data";
import { currentTerm, requireMember } from "~/lib/roles";
import { isUserInAnyGroup } from "~/lib/groups";
import { interpretBidForm } from "~/projects/lib/bid-form-interpreter";
import { validateBids, replaceBidSet } from "~/projects/lib/bid-validation";
import { interpretIntentForm } from "~/projects/lib/intent-form-interpreter";
import { replaceIntentSet } from "~/projects/lib/intent-validation";
import {
  parseColumnMapping,
  validateMapping,
  type ColumnMapping,
} from "~/projects/lib/slot-roles";
import { pickStaffingBinding, type Slot } from "~/projects/lib/form-slots";
import {
  interpretProfileForm,
  NEW_MEMBER_PROFILE_FORM_NAME,
  type ProfileUpdate,
} from "~/members/lib/profile-form-interpreter";
import { clearOnboardingTask } from "~/members/lib/welcome.server";
import { syncSlackUserId } from "~/members/lib/slack-sync.server";
import { notifyFormSubmission } from "./submission-notify.server";

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
        termId: q.data.referenceTermId,
      });
      return { ...q, data: { ...q.data, referenceOptions: options } };
    }),
  );

  return {
    formId: form.id,
    name: form.name,
    versionId: version.id,
    // Frozen versions may hold legacy ProseMirror JSON — convert on read so
    // fill surfaces only ever see block JSON.
    description: ensureBlocks(safeParseJsonString(version.intro)),
    questions: normalizeQuestionBodies(resolved),
  };
}

// Shared answer validation for the authenticated submit paths (member fills,
// the partner apply flow, and the education apply flow, which validates
// against an offering-bound form without going through the public token
// path). Returns an error result, or null when the answers are valid.
export async function validateAnswers(
  questions: Question[],
  answers: Record<string, unknown>,
  // Null on anonymous (Public-audience) fills — member-scoped reference
  // sources then resolve to [] and their answers can't validate.
  userId: string | null,
): Promise<{ error: string; status: number } | null> {
  // Checkbox answers arrive as a JSON-stringified array (the fill UIs keep
  // string-valued state); parse, validate against the question's options, and
  // normalize IN PLACE so every caller (member fill, education apply, partner
  // apply) persists a real string[] in the answers JSON. Runs before the
  // required pass so a '[]' payload normalizes to [] and is caught as empty.
  for (const q of questions) {
    if (q.type !== "checkbox") continue;
    const raw = answers[q.key];
    if (raw == null || raw === "") continue; // unanswered — required pass handles it
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((v): v is string => typeof v === "string")
    ) {
      return {
        error: `"${q.data.label}": couldn't read the selected options.`,
        status: 400,
      };
    }
    const allowed = new Set(q.data.options ?? []);
    if (parsed.some((v) => !allowed.has(v))) {
      return {
        error: `"${q.data.label}": that choice is no longer available.`,
        status: 400,
      };
    }
    answers[q.key] = [...new Set(parsed)];
  }

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
      termId: q.data.referenceTermId,
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

// A member's prior ORDINARY submission of this form: attributed to them and
// carrying no staffing/education scope. This where-clause DEFINES what the
// oneResponsePerMember toggle gates — slot-bound fills (project-bids /
// intent-to-work / level-up) and education fills are excluded because those
// keep replace / per-session semantics regardless of the toggle.
export async function existingOrdinarySubmission(
  formId: string,
  userId: string,
): Promise<{ id: string; createdAt: Date } | null> {
  return prisma.formSubmission.findFirst({
    where: {
      formId,
      userId,
      slot: null,
      staffingCycleId: null,
      educationOfferingId: null,
      educationSessionId: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true },
  });
}

// Loader-side twin of submitMemberForm's ordinary-branch 409 gate: the fill
// page uses this to show the "already filled out" panel instead of the form.
// Must mirror the submit gate exactly — same binding detection (a slot-bound
// form's replace semantics win over the toggle), same where-clause.
export async function ordinaryFillBlock(
  formId: string,
  userId: string,
): Promise<{ at: Date } | null> {
  const form = await prisma.form.findUnique({
    where: { id: formId },
    select: {
      oneResponsePerMember: true,
      cycleBindings: {
        select: {
          slot: true,
          updatedAt: true,
          staffingCycle: { select: { termId: true } },
        },
      },
    },
  });
  if (!form?.oneResponsePerMember) return null;
  const term = await currentTerm();
  if (pickStaffingBinding(form.cycleBindings, term?.id ?? null)) return null;
  const existing = await existingOrdinarySubmission(formId, userId);
  return existing ? { at: existing.createdAt } : null;
}

// Just enough of a published form to decide who may fill it — queried before
// any session handling, and cheap enough for the submit endpoint to reuse
// (unlike loadPublicForm, which resolves reference options per question).
// Null when the token is unknown or the form is unpublished.
export type FormAccessMeta = {
  id: string;
  name: string;
  audience: FormAudience;
  audienceGroupIds: string[];
};

export async function formAccessMeta(
  token: string,
): Promise<FormAccessMeta | null> {
  const form = await prisma.form.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      name: true,
      published: true,
      audience: true,
      audienceGroupIds: true,
    },
  });
  if (!form || !form.published) return null;
  return {
    id: form.id,
    name: form.name,
    audience: form.audience,
    audienceGroupIds: form.audienceGroupIds,
  };
}

export type FillAccess = "ok" | "login" | "denied";

// The single audience gate — the fill loader and the submit action both call
// this so their decisions can't drift. `userId` is null when there is no
// session. Note Groups does NOT fall back to lab membership: only the
// selected groups admit.
export async function formFillAccess(
  form: Pick<FormAccessMeta, "audience" | "audienceGroupIds">,
  userId: string | null,
): Promise<FillAccess> {
  if (form.audience === "Public") return "ok";
  if (!userId) return "login";
  if (form.audience === "SignedIn") return "ok";
  if (form.audience === "Members") {
    return (await requireMember(userId)) ? "ok" : "denied";
  }
  return (await isUserInAnyGroup(userId, form.audienceGroupIds))
    ? "ok"
    : "denied";
}

// "Forms for you" (member Home): published + listed forms whose audience
// admits the viewer. Listing is opt-in per form (Form.listed) — audience
// controls who CAN fill, listed controls whether the form is discoverable
// at all; unlisted forms stay reachable only by link. One-response forms the
// member already submitted are dropped (no point nudging them toward the
// "already filled out" panel). Sequential access checks are fine at the
// handful-of-listed-forms scale.
export type ListedForm = { id: string; name: string; fillUrl: string };

export async function listedFormsFor(userId: string): Promise<ListedForm[]> {
  const forms = await prisma.form.findMany({
    where: { listed: true, published: true, publicToken: { not: null } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      publicToken: true,
      audience: true,
      audienceGroupIds: true,
      oneResponsePerMember: true,
    },
  });

  const visible: ListedForm[] = [];
  for (const form of forms) {
    if ((await formFillAccess(form, userId)) !== "ok") continue;
    if (
      form.oneResponsePerMember &&
      (await existingOrdinarySubmission(form.id, userId))
    ) {
      continue;
    }
    visible.push({
      id: form.id,
      name: form.name,
      fillUrl: `/forms/fill/${form.publicToken}`,
    });
  }
  return visible;
}

export type MemberSubmitResult =
  | { ok: true }
  | { error: string; status: number };

// The version a submission should record against: the client-provided id
// when it still exists on this form, else the latest — the form may have
// been re-versioned between page load and submit, and that shouldn't
// hard-fail the fill. Null only when the form has no versions at all.
async function resolveSubmitVersion(form: {
  id: string;
  versions: { id: string; questions: unknown }[];
}): Promise<{ id: string; questions: unknown } | null> {
  if (form.versions[0]) return form.versions[0];
  return prisma.formVersion.findFirst({
    where: { formId: form.id },
    orderBy: { versionNumber: "desc" },
    select: { id: true, questions: true },
  });
}

// Anonymous (Public-audience) submit: records a plain, unattributed row with
// the client IP for abuse tracing. Deliberately none of the member-path side
// effects — no todo closing, no one-response gate (no identity to key on),
// no profile/staffing/education interpretation even when the form happens to
// be slot-bound.
export async function submitAnonymousForm(args: {
  token: string;
  versionId: string;
  answers: Record<string, unknown>;
  submitterIp: string | null;
}): Promise<MemberSubmitResult> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: {
      id: true,
      published: true,
      audience: true,
      versions: {
        where: { id: args.versionId },
        select: { id: true, questions: true },
      },
    },
  });
  if (!form || !form.published) {
    return { error: "Form not found for this link.", status: 404 };
  }
  // Defense-in-depth: this is the only entry point that creates unattributed
  // rows, so it enforces its own precondition even though the action gates
  // with formFillAccess first.
  if (form.audience !== "Public") {
    return { error: "This form requires signing in.", status: 403 };
  }
  const version = await resolveSubmitVersion(form);
  if (!version) {
    return { error: "This form has no questions yet.", status: 404 };
  }

  const questions = (version.questions as unknown as Question[]) ?? [];
  const bad = await validateAnswers(questions, args.answers, null);
  if (bad) return bad;

  await prisma.formSubmission.create({
    data: {
      formId: form.id,
      formVersionId: version.id,
      userId: null,
      answers: args.answers as object,
      submitterIp: args.submitterIp,
    },
  });
  await notifyFormSubmission({ formId: form.id });
  return { ok: true };
}

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
  // Education feedback context (session feedback / instructor exit survey),
  // carried from the fill URL's ?session= / ?offering= params. Validated
  // server-side against EducationFormBinding — never trusted beyond the ids.
  education?: { sessionId?: string | null; offeringId?: string | null };
}): Promise<MemberSubmitResult> {
  const form = await prisma.form.findUnique({
    where: { publicToken: args.token },
    select: {
      id: true,
      name: true,
      published: true,
      oneResponsePerMember: true,
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
          updatedAt: true,
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
  const version = await resolveSubmitVersion(form);
  if (!version) {
    return { error: "This form has no questions yet.", status: 404 };
  }

  const questions = (version.questions as unknown as Question[]) ?? [];
  const bad = await validateAnswers(questions, args.answers, args.userId);
  if (bad) return bad;

  // Fired once after each success path's transaction commits (never inside
  // it) — best-effort creator notification, see submission-notify.server.
  const notifySubmitted = () =>
    notifyFormSubmission({ formId: form.id, submitterUserId: args.userId });

  // Education feedback branch: an explicit session/offering context wins over
  // every other interpretation. The context re-derives the binding + the
  // submitter's authorization (enrolled / instructor); the submission records
  // its education scope, and ONLY the todo for this exact session/offering is
  // closed — one form serves N sessions, so the formId-wide closeFormTodos
  // below would wipe the other pending session todos.
  if (args.education?.sessionId || args.education?.offeringId) {
    const { educationFillContext, closeEducationFormTodos } = await import(
      "~/education/lib/feedback.server"
    );
    const context = await educationFillContext({
      formId: form.id,
      userId: args.userId,
      sessionId: args.education.sessionId,
      offeringId: args.education.offeringId,
    });
    if (!context) {
      return {
        error: "This link isn't valid for you — ask the instructor for a fresh one.",
        status: 403,
      };
    }
    const linkQuery = context.sessionId
      ? `?session=${context.sessionId}`
      : `?offering=${context.offeringId}`;
    await prisma.$transaction(async (tx) => {
      await tx.formSubmission.create({
        data: {
          formId: form.id,
          formVersionId: version.id,
          userId: args.userId,
          answers: args.answers as object,
          slot: context.slot,
          educationOfferingId: context.offeringId,
          educationSessionId: context.sessionId,
        },
      });
      await closeEducationFormTodos(tx, {
        userId: args.userId,
        formId: form.id,
        linkQuery,
      });
    });
    await notifySubmitted();
    return { ok: true };
  }

  // Which staffing cycle (if any) this submission feeds is decided by the
  // form's own bindings, not the calendar's current term — see
  // pickStaffingBinding. currentTerm only breaks ties when a form is reused
  // across cycles.
  const term = await currentTerm();
  const staffingBinding = pickStaffingBinding(
    form.cycleBindings,
    term?.id ?? null,
  );

  if (!staffingBinding) {
    // One-response gate (ordinary fills only — the branches above/below keep
    // their own resubmission semantics). App-level check: FormSubmission has
    // no unique constraint, so a double-click race can still slip one extra
    // row through — acceptable for this surface.
    if (form.oneResponsePerMember) {
      const existing = await existingOrdinarySubmission(form.id, args.userId);
      if (existing) {
        return { error: "You've already filled out this form.", status: 409 };
      }
    }

    // The onboarding "New Member Profile" form IS the onboarding step: it writes
    // its answers onto the member's User profile fields (see profile-form-
    // interpreter) AND completes onboarding (stamps DALIMember.onboardedAt +
    // clears the persistent onboarding task). Everything else (Slack, calendar)
    // happens in earlier provisioning / the later party tour.
    // Members only: a non-member admitted by a SignedIn/Groups audience must
    // not write profile fields by submitting a form with the reserved name.
    const isProfileForm =
      form.name === NEW_MEMBER_PROFILE_FORM_NAME &&
      Boolean(await requireMember(args.userId));
    let profileUpdate: ProfileUpdate | null = null;
    if (isProfileForm) {
      const interpreted = interpretProfileForm(args.answers);
      if (!interpreted.ok) return { error: interpreted.error, status: 400 };
      profileUpdate = interpreted.update;
    }

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
      if (profileUpdate && Object.keys(profileUpdate).length > 0) {
        await tx.user.update({ where: { id: args.userId }, data: profileUpdate });
      }
      if (isProfileForm) {
        // Submitting the profile form finishes onboarding.
        await tx.dALIMember.updateMany({
          where: { userId: args.userId, onboardedAt: null },
          data: { onboardedAt: new Date() },
        });
      }
      await closeFormTodos(tx, args.userId, form.id);
    });
    if (isProfileForm) {
      await clearOnboardingTask(args.userId);
      // Onboarding Slack-account sync: by now the member may have joined Slack
      // (e.g. via the welcome invite), so try to resolve + store their Slack
      // user id for future per-project channel invites. Best-effort.
      await syncSlackUserId(args.userId).catch(() => {});
    }
    await notifySubmitted();
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
    await notifySubmitted();
    return { ok: true };
  }

  if (slot === "level-up") {
    await prisma.$transaction(async (tx) => {
      await tx.formSubmission.create({
        data: {
          formId: form.id,
          formVersionId: version.id,
          userId: args.userId,
          staffingCycleId: cycle.id,
          slot: "level-up",
          answers: args.answers as object,
        },
      });
      await closeFormTodos(tx, args.userId, form.id);
    });
    await notifySubmitted();
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
  await notifySubmitted();
  return { ok: true };
}

// Mark the member's open announcement-todo notifications that pointed at this
// form as read. listOpenTasks / countOpenTasks treat any unread notification
// as an open task, so once these flip the Home banner item disappears and
// the sidebar count drops.
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
