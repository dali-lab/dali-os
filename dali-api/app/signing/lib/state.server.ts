// Signing state + outstanding-obligation resolution — the generalized analog of
// app/hiring/lib/confidentiality.ts. Enforcement is computed live (no
// per-subject assignment rows): a member owes a signature when an enforced
// document has a published version in force for a context they're in the
// audience of, and they haven't signed that version.

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { isUserActiveInTerm, resolveGroupMembers } from "~/lib/groups";
import { isNewMemberCohort } from "~/hiring/lib/new-member-cohort.server";
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
}

// Every app-enforced binding this user still owes a member signature on.
//
// A term-scoped binding gates for its OWN term as long as that term is the
// current one OR an upcoming one — agreements are issued for a chosen term
// (often before it starts), and the audience is resolved against that term's
// staffing, so a member staffed in the upcoming term owes it now. A PAST term's
// binding never blocks the app once the term has rolled by. App-scoped (Once)
// bindings gate on the current term.
export async function listOutstandingBindings(userId: string): Promise<OutstandingBinding[]> {
  const { exempt, isMember } = await baseMemberFlag(userId);
  if (exempt) return [];
  const current = await currentTerm();

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
        select: { id: true, name: true, audience: true, audienceGroupId: true },
      },
      signatures: {
        where: { signerUserId: userId, roleKey: "member" },
        select: { versionId: true },
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
    const signed = b.signatures.some((s) => s.versionId === b.versionId);
    if (signed) continue;
    out.push({
      bindingId: b.id,
      documentId: b.document.id,
      documentName: b.document.name,
      versionId: b.versionId,
    });
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
      roleKey: "member",
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

// State of one binding for one member (has this user signed the in-force
// version as "member"?).
export async function getBindingStateForUser(
  userId: string,
  bindingId: string,
): Promise<BindingSignState> {
  const b = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      versionId: true,
      signatures: {
        where: { signerUserId: userId, roleKey: "member" },
        select: { versionId: true },
      },
    },
  });
  if (!b) return { status: "not_found" };
  const signed = b.signatures.some((s) => s.versionId === b.versionId);
  return { status: signed ? "signed" : "unsigned" };
}

// App-gate helper for the layout loader: the first App-scoped binding the user
// still owes, or null. The layout redirects to /sign when non-null.
export async function getAppGateOutstanding(userId: string): Promise<OutstandingBinding | null> {
  const outstanding = await listOutstandingBindings(userId);
  return outstanding[0] ?? null;
}
