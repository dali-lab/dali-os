// App-lock for bound staffing forms — the forms analog of the signing app-gate
// (app/signing/lib/state.server.ts). When a staffing manager sets a bound
// form's gateAudience, members in that audience who haven't filled it are
// hard-gated into the fill page before they can use the rest of the app.
// Reuses the signing audience resolvers so
// "who owes this" is defined in exactly one place.
import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { resolveGroupMembers } from "~/lib/groups";
import { getSignerCohorts } from "~/signing/lib/state.server";
import { AUDIENCE_RESOLVERS } from "~/signing/lib/audiences";
import { existingBoundSubmission, formFillAccess } from "~/forms/lib/public-form";
import { boundSlotCycleIds } from "~/projects/lib/form-slots";

export interface OutstandingBoundForm {
  token: string;
  slot: string;
  formName: string;
}

// The first bound form the member owes for the current staffing cycle, or null.
// Returns null cheaply when nothing is gated, before any
// cohort/group resolution.
export async function getBoundFormGateOutstanding(
  userId: string,
  request?: Request,
): Promise<OutstandingBoundForm | null> {
  const term = await currentTerm(request);
  if (!term) return null;
  const cycle = await prisma.staffingCycle.findUnique({
    where: { termId: term.id },
    select: { id: true },
  });
  if (!cycle) return null;

  // Only bound slots that are actually locked and fillable (published form with
  // a token) can gate anyone.
  const bindings = await prisma.staffingCycleFormBinding.findMany({
    where: {
      staffingCycleId: cycle.id,
      gateAudience: { not: null },
      form: { published: true, publicToken: { not: null } },
    },
    orderBy: { slot: "asc" },
    select: {
      slot: true,
      formId: true,
      gateAudience: true,
      gateAudienceGroupId: true,
      form: {
        select: {
          name: true,
          publicToken: true,
          audience: true,
          audienceGroupIds: true,
        },
      },
    },
  });
  if (bindings.length === 0) return null;

  // Cohorts drive the audience match; full-time staff resolve to NO_COHORTS, so
  // they never match and are never gated. Fixed-group membership is precomputed
  // once so includes() stays synchronous (mirrors state.server.ts).
  const cohorts = await getSignerCohorts(userId);
  const fixedGroupIds = [
    ...new Set(
      bindings
        .filter((b) => b.gateAudience === "Group" && b.gateAudienceGroupId)
        .map((b) => b.gateAudienceGroupId as string),
    ),
  ];
  const userGroupIds = new Set<string>();
  for (const gid of fixedGroupIds) {
    if ((await resolveGroupMembers(gid)).includes(userId)) userGroupIds.add(gid);
  }

  for (const b of bindings) {
    const audience = b.gateAudience;
    if (!audience) continue;
    const inAudience = AUDIENCE_RESOLVERS[audience].includes(cohorts, {
      audienceGroupId: b.gateAudienceGroupId,
      userGroupIds,
    });
    if (!inAudience) continue;
    // Never gate a member into a form they can't actually fill — the gate
    // audience and the form's own fill audience are set independently, so a
    // mismatch would dead-end them on the fill page's access screen. Re-check
    // the real fill gate before redirecting.
    const access = await formFillAccess(
      { audience: b.form.audience, audienceGroupIds: b.form.audienceGroupIds },
      userId,
    );
    if (access !== "ok") continue;
    // Filled already (one-and-done) ⇒ nothing owed. Spans every cycle the form
    // is bound to, not just this term's, so a re-bind doesn't gate a member
    // back into a form they've filled.
    if (
      await existingBoundSubmission(
        userId,
        await boundSlotCycleIds(b.formId, b.slot),
        b.slot,
      )
    )
      continue;
    return {
      token: b.form.publicToken as string,
      slot: b.slot,
      formName: b.form.name,
    };
  }
  return null;
}
