// Signing state + outstanding-obligation resolution — the generalized analog of
// app/hiring/lib/confidentiality.ts. Enforcement is computed live (no
// per-subject assignment rows): a member owes a signature when an enforced
// document has a published version in force for a context they're in the
// audience of, and they haven't signed that version.

import { prisma } from "~/lib/db";
import { currentTerm, isLabMentor } from "~/lib/roles";
import { isUserActiveInTerm, resolveGroupMembers } from "~/lib/groups";
import { isNewMemberCohort } from "~/hiring/lib/new-member-cohort.server";
import { AUDIENCE_RESOLVERS } from "./audiences";

export interface SignerCohorts {
  isMember: boolean;
  // A member of the current incoming cohort (latest General/Fellowship hires).
  isNewMember: boolean;
  isMentor: boolean;
  // Active/staffed in the current term (the term group's membership rule).
  // Gates the term-group Group audience so off-term members aren't required.
  isActiveThisTerm: boolean;
}

export async function getSignerCohorts(userId: string): Promise<SignerCohorts> {
  const [member, u, term] = await Promise.all([
    prisma.dALIMember.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { membershipStatus: true, adminMembership: { select: { isStaff: true } } },
    }),
    currentTerm(),
  ]);
  // Full-time staff are exempt from signing obligations entirely (they also
  // skip the student onboarding flow).
  if (u?.adminMembership?.isStaff)
    return { isMember: false, isNewMember: false, isMentor: false, isActiveThisTerm: false };
  const isMember = !!member && u?.membershipStatus !== "Alumni";
  const [isMentor, isNewMember, isActiveThisTerm] = await Promise.all([
    isLabMentor(userId, term?.id),
    isMember ? isNewMemberCohort(userId) : Promise.resolve(false),
    term ? isUserActiveInTerm(userId, term.id) : Promise.resolve(false),
  ]);
  return { isMember, isNewMember, isMentor, isActiveThisTerm };
}

export interface OutstandingBinding {
  bindingId: string;
  documentId: string;
  documentName: string;
  kind: string;
  versionId: string;
}

// Every app-enforced binding this user still owes a member signature on.
export async function listOutstandingBindings(userId: string): Promise<OutstandingBinding[]> {
  const cohorts = await getSignerCohorts(userId);
  if (!cohorts.isMember && !cohorts.isMentor && !cohorts.isActiveThisTerm) return [];

  const bindings = await prisma.signingBinding.findMany({
    where: {
      document: { archivedAt: null, gateScope: "App" },
      version: { publishedAt: { not: null } },
    },
    select: {
      id: true,
      versionId: true,
      document: {
        select: { id: true, name: true, audience: true, audienceGroupId: true, kind: true },
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

  const out: OutstandingBinding[] = [];
  for (const b of bindings) {
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
      kind: b.document.kind,
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
      binding: { document: { kind: { not: "Confidentiality" }, archivedAt: null } },
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
