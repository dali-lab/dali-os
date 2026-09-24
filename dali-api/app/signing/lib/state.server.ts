// Signing state + outstanding-obligation resolution — the generalized analog of
// app/hiring/lib/confidentiality.ts. Enforcement is computed live (no
// per-subject assignment rows): a member owes a signature when an enforced
// document has a published version in force for a context they're in the
// audience of, and they haven't signed that version.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { isUserActiveInTerm, resolveGroupMembers } from "~/lib/groups";
import { isNewMemberCohort } from "~/hiring/lib/new-member-cohort.server";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { isStaffedInTerm, isStaffedMentorInTerm } from "./staffing-audience.server";
import { AUDIENCE_RESOLVERS } from "./audiences";

export interface SignerCohorts {
  isMember: boolean;
  // Staffed this term = a ProjectAssignment or CoreAssignment in the current
  // term. Gates the new/returning member agreements, which partition this set.
  isStaffedThisTerm: boolean;
  // Staffed this term and in the incoming hire cohort (accepted in the latest
  // General/Fellowship cycle) → owes the *new* member agreement rather than the
  // returning one.
  isNewStaffed: boolean;
  // Mentoring this term (P3 project ∪ external mentor). Gates the mentor agreement.
  isMentor: boolean;
  // Active in the term group (project ∪ core ∪ instructor ∪ mentorship). Gates
  // the term-group Group audience so off-term members aren't required.
  isActiveThisTerm: boolean;
}

const NO_COHORTS: SignerCohorts = {
  isMember: false,
  isStaffedThisTerm: false,
  isNewStaffed: false,
  isMentor: false,
  isActiveThisTerm: false,
};

// Base membership flag, term-independent. Full-time staff are exempt from
// signing obligations entirely (they also skip the student onboarding flow).
async function baseMemberFlag(
  userId: string,
): Promise<{ exempt: boolean; isMember: boolean }> {
  const [member, u] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { membershipStatus: true, adminMembership: { select: { isStaff: true } } },
    }),
  ]);
  if (u?.adminMembership?.isStaff) return { exempt: true, isMember: false };
  return { exempt: false, isMember: !!member && u?.membershipStatus !== "Alumni" };
}

// The term-dependent cohort flags for a SPECIFIC term — so a binding scoped to
// an upcoming term (agreements issued early, before it starts) is gated against
// that term's staffing, not today's.
async function cohortsForTerm(
  userId: string,
  isMember: boolean,
  term: { id: string; sortKey: number },
): Promise<SignerCohorts> {
  const [isStaffedThisTerm, isNewHire, isMentor, isActiveThisTerm] = await Promise.all([
    isStaffedInTerm(userId, term.id),
    isNewMemberCohort(userId),
    isStaffedMentorInTerm(userId, term.id),
    isUserActiveInTerm(userId, term.id),
  ]);
  return {
    isMember,
    isStaffedThisTerm,
    isNewStaffed: isStaffedThisTerm && isNewHire,
    isMentor,
    isActiveThisTerm,
  };
}

export async function getSignerCohorts(userId: string): Promise<SignerCohorts> {
  const { exempt, isMember } = await baseMemberFlag(userId);
  if (exempt) return NO_COHORTS;
  const term = await currentTerm();
  if (!term) return { ...NO_COHORTS, isMember };
  return cohortsForTerm(userId, isMember, term);
}

// Cohorts for gating ONE binding: a term-scoped binding gates on its OWN term
// (which may be an upcoming term whose agreements were issued early); an
// app-scoped binding (no term) gates on the current term. Used by the /sign
// audience checks so a member staffed only in the upcoming term can open the
// agreement the app-gate sends them to.
export async function getSignerCohortsForBinding(
  userId: string,
  termId: string | null,
): Promise<SignerCohorts> {
  if (!termId) return getSignerCohorts(userId);
  const { exempt, isMember } = await baseMemberFlag(userId);
  if (exempt) return NO_COHORTS;
  const term = await prisma.term.findUnique({
    where: { id: termId },
    select: { id: true, sortKey: true },
  });
  if (!term) return { ...NO_COHORTS, isMember };
  return cohortsForTerm(userId, isMember, term);
}

export interface OutstandingBinding {
  bindingId: string;
  documentId: string;
  documentName: string;
  versionId: string;
  // Which slot this user owes on the binding. "member" is the normal signer
  // obligation (audience-derived); "mentee" is a mentorship-agreement
  // countersignature owed because one of the user's mentors signed it.
  role: "member" | "mentee";
}

// Every app-enforced binding this user still owes a member signature on.
//
// A term-scoped binding gates for its OWN term as long as that term is the
// current one OR an upcoming one — agreements are issued for a chosen term
// (often before it starts), and the audience is resolved against that term's
// staffing, so a member staffed in the upcoming term owes it now. A PAST term's
// binding never blocks the app once the term has rolled by. App-scoped (Once)
// bindings gate on the current term.
export async function listOutstandingBindings(
  userId: string,
  opts: { includeMentee?: boolean; request?: Request } = {},
): Promise<OutstandingBinding[]> {
  const includeMentee = opts.includeMentee ?? true;
  const { exempt, isMember } = await baseMemberFlag(userId);
  if (exempt) return [];
  const current = await currentTerm(opts.request);

  const bindings = await prisma.signingBinding.findMany({
    where: {
      document: { archivedAt: null, gateScope: "App" },
      version: { publishedAt: { not: null } },
    },
    select: {
      id: true,
      versionId: true,
      termId: true,
      term: { select: { id: true, sortKey: true } },
      document: {
        select: {
          id: true,
          name: true,
          audience: true,
          audienceGroupId: true,
          requiresMenteeCountersign: true,
        },
      },
      // Both roles this user might hold on the binding: "member" answers the
      // normal signer gate; "mentee" is read by the countersignature pass below.
      signatures: {
        where: { signerUserId: userId, roleKey: { in: ["member", "mentee"] } },
        select: { versionId: true, roleKey: true },
      },
    },
  });

  // Which fixed target groups this signer belongs to (term-group Group audiences
  // gate on the isActiveThisTerm cohort flag instead, so they need no lookup).
  // Resolved once here to keep the includes() check below synchronous.
  const fixedGroupIds = [
    ...new Set(
      bindings
        .filter((b) => b.document.audience === "Group" && b.document.audienceGroupId)
        .map((b) => b.document.audienceGroupId as string),
    ),
  ];
  const userGroupIds = new Set<string>();
  for (const gid of fixedGroupIds) {
    if ((await resolveGroupMembers(gid)).includes(userId)) userGroupIds.add(gid);
  }

  // Cohorts computed per relevant term: current-term cohorts for app-scoped
  // bindings, and one snapshot per distinct current-or-upcoming binding term.
  const currentCohorts = current
    ? await cohortsForTerm(userId, isMember, current)
    : { ...NO_COHORTS, isMember };
  const cohortsByTerm = new Map<string, SignerCohorts>();
  if (current) {
    const upcomingTerms = new Map<string, { id: string; sortKey: number }>();
    for (const b of bindings) {
      if (b.term && b.term.sortKey >= current.sortKey) upcomingTerms.set(b.term.id, b.term);
    }
    for (const t of upcomingTerms.values()) {
      cohortsByTerm.set(t.id, await cohortsForTerm(userId, isMember, t));
    }
  }

  const out: OutstandingBinding[] = [];
  for (const b of bindings) {
    let cohorts: SignerCohorts;
    if (!b.termId) {
      cohorts = currentCohorts;
    } else {
      // Skip a past term's binding (and, when there's no current term to anchor
      // against, all term-scoped bindings).
      if (!current || !b.term || b.term.sortKey < current.sortKey) continue;
      cohorts = cohortsByTerm.get(b.term.id) ?? currentCohorts;
    }
    const inAudience = AUDIENCE_RESOLVERS[b.document.audience].includes(cohorts, {
      audienceGroupId: b.document.audienceGroupId,
      userGroupIds,
    });
    if (!inAudience) continue;
    const signed = b.signatures.some(
      (s) => s.roleKey === "member" && s.versionId === b.versionId,
    );
    if (signed) continue;
    out.push({
      bindingId: b.id,
      documentId: b.document.id,
      documentName: b.document.name,
      versionId: b.versionId,
      role: "member",
    });
  }

  // Mentee countersignatures — a parallel obligation the audience machinery
  // doesn't express (a mentee is not in the Mentors audience). Runs only when
  // the feature is live for everyone and the caller opts in (the web gate/inbox
  // do; MCP does not — it can't sign a countersignature yet). All lookups are
  // batched OUTSIDE the per-binding loop to keep this hot path free of
  // per-binding round-trips (mirrors the userGroupIds precompute above).
  if (
    includeMentee &&
    current &&
    (await isFeatureEnabledForEveryone("mentee-countersign", opts.request))
  ) {
    // Candidate bindings: opt-in doc, term-scoped, current-or-upcoming (a past
    // term's agreement never blocks the app, matching the member rule above).
    const candidates = bindings.filter(
      (b) =>
        b.document.requiresMenteeCountersign &&
        b.termId &&
        b.term &&
        b.term.sortKey >= current.sortKey &&
        // Already countersigned the in-force version → nothing owed. Checked
        // first so a later re-finalize / mentor un-sign can't re-gate someone.
        !b.signatures.some((s) => s.roleKey === "mentee" && s.versionId === b.versionId),
    );
    if (candidates.length > 0) {
      const termIds = [...new Set(candidates.map((b) => b.termId as string))];
      const pairs = await prisma.mentorshipPair.findMany({
        where: { menteeUserId: userId, termId: { in: termIds } },
        select: { mentorUserId: true, termId: true },
      });
      const mentorsByTerm = new Map<string, Set<string>>();
      for (const p of pairs) {
        let set = mentorsByTerm.get(p.termId);
        if (!set) mentorsByTerm.set(p.termId, (set = new Set()));
        set.add(p.mentorUserId);
      }
      const allMentorIds = [...new Set(pairs.map((p) => p.mentorUserId))];
      // Which of my mentors have signed each candidate binding's in-force
      // version (keyed signer:version so an old-version mentor sig doesn't count).
      const signedMentorKeys = new Set<string>();
      if (allMentorIds.length > 0) {
        const mentorSigs = await prisma.signingSignature.findMany({
          where: {
            bindingId: { in: candidates.map((b) => b.id) },
            roleKey: "member",
            signerUserId: { in: allMentorIds },
          },
          select: { bindingId: true, signerUserId: true, versionId: true },
        });
        for (const s of mentorSigs) {
          signedMentorKeys.add(`${s.bindingId}:${s.signerUserId}:${s.versionId}`);
        }
      }
      for (const b of candidates) {
        const myMentors = mentorsByTerm.get(b.termId as string);
        if (!myMentors || myMentors.size === 0) continue; // not a mentee here
        const anyMentorSigned = [...myMentors].some((m) =>
          signedMentorKeys.has(`${b.id}:${m}:${b.versionId}`),
        );
        if (!anyMentorSigned) continue;
        out.push({
          bindingId: b.id,
          documentId: b.document.id,
          documentName: b.document.name,
          versionId: b.versionId,
          role: "mentee",
        });
      }
    }
  }

  return out;
}

export async function countOutstandingBindings(userId: string): Promise<number> {
  return (await listOutstandingBindings(userId)).length;
}

export interface SignedDocument {
  signatureId: string;
  bindingId: string;
  documentName: string;
  context: string;
  signedAt: Date;
}

// A member's own signed lab agreements (Membership / Mentorship / General),
// newest first — for the personal "My agreements" archive. Excludes hiring
// Confidentiality (hiring-internal, no member-facing copy).
export async function listMySignedDocuments(userId: string): Promise<SignedDocument[]> {
  const sigs = await prisma.signingSignature.findMany({
    where: {
      signerUserId: userId,
      // Member signatures and mentee countersignatures both belong in the
      // personal archive; the pre-signed "supervisor" role never does.
      roleKey: { in: ["member", "mentee"] },
      binding: { document: { gateScope: { not: "HiringCycle" }, archivedAt: null } },
    },
    select: {
      id: true,
      signedAt: true,
      bindingId: true,
      binding: {
        select: {
          document: { select: { name: true } },
          term: { select: { code: true } },
          cycle: { select: { name: true } },
        },
      },
    },
    orderBy: { signedAt: "desc" },
  });
  return sigs.map((s) => ({
    signatureId: s.id,
    bindingId: s.bindingId,
    documentName: s.binding.document.name,
    context: s.binding.cycle?.name
      ? s.binding.cycle.name
      : s.binding.term?.code
        ? `Term ${s.binding.term.code}`
        : "Lab-wide",
    signedAt: s.signedAt,
  }));
}

export type BindingSignState =
  | { status: "not_found" }
  | { status: "unsigned" }
  | { status: "signed" };

// State of one binding for one signer, in a given role (has this user signed
// the in-force version as `roleKey`?). Defaults to "member"; the mentee fill
// flow passes "mentee" to read the countersignature slot.
export async function getBindingStateForUser(
  userId: string,
  bindingId: string,
  roleKey: string = "member",
): Promise<BindingSignState> {
  const b = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      versionId: true,
      signatures: {
        where: { signerUserId: userId, roleKey },
        select: { versionId: true },
      },
    },
  });
  if (!b) return { status: "not_found" };
  const signed = b.signatures.some((s) => s.versionId === b.versionId);
  return { status: signed ? "signed" : "unsigned" };
}

export type MenteeCountersignState = "not_owed" | "owed" | "signed";

// Whether `userId` owes / has completed a mentee countersignature on one
// binding. The single-binding analog of the mentee pass in
// listOutstandingBindings; shared by the sign route + PDF route so the gate,
// the fill flow, and the app-gate all agree. Predicate order matters: a
// completed countersignature short-circuits FIRST, so a later re-finalize
// (which rewrites non-manual MentorshipPair rows) or a mentor un-signing can
// never re-gate someone who already countersigned.
export async function menteeCountersignState(
  userId: string,
  bindingId: string,
  request?: Request,
): Promise<MenteeCountersignState> {
  const b = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      versionId: true,
      termId: true,
      document: { select: { requiresMenteeCountersign: true, gateScope: true } },
      term: { select: { sortKey: true } },
      signatures: {
        where: { signerUserId: userId, roleKey: "mentee" },
        select: { versionId: true },
      },
    },
  });
  if (!b) return "not_owed";
  if (b.signatures.some((s) => s.versionId === b.versionId)) return "signed";
  if (
    !b.document.requiresMenteeCountersign ||
    b.document.gateScope !== "App" ||
    !b.termId ||
    !b.term
  ) {
    return "not_owed";
  }
  if (!(await isFeatureEnabledForEveryone("mentee-countersign", request))) return "not_owed";
  const current = await currentTerm(request);
  if (!current || b.term.sortKey < current.sortKey) return "not_owed";

  const pairs = await prisma.mentorshipPair.findMany({
    where: { menteeUserId: userId, termId: b.termId },
    select: { mentorUserId: true },
  });
  if (pairs.length === 0) return "not_owed";

  const mentorSigned = await prisma.signingSignature.findFirst({
    where: {
      bindingId,
      roleKey: "member",
      versionId: b.versionId,
      signerUserId: { in: pairs.map((p) => p.mentorUserId) },
    },
    select: { id: true },
  });
  return mentorSigned ? "owed" : "not_owed";
}

// App-gate helper for the layout loader: the first App-scoped binding the user
// still owes, or null. The layout redirects to /sign when non-null. Includes
// mentee countersignatures (the layout gate blocks a mentee until they
// countersign, same as a mentor); pass `request` so the flag + term lookups are
// request-cached.
export async function getAppGateOutstanding(
  userId: string,
  request?: Request,
): Promise<OutstandingBinding | null> {
  const outstanding = await listOutstandingBindings(userId, { includeMentee: true, request });
  return outstanding[0] ?? null;
}
