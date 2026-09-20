import { redirect } from "react-router";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";

// Status of a user's confidentiality state for a given cycle.
//   no_agreement — hiring lead has not bound an agreement; nobody can see
//                  sensitive cycle data, including the hiring lead.
//   unsigned     — agreement is bound but this user has not signed the
//                  currently-bound version.
//   signed       — user has signed the currently-bound version.
// `exempt` is set for Core (which includes Admins): they see cycle data
// whatever the status, so gates check confidentialityCleared rather than the status.
// The status still reflects their real signature, so they can sign if they
// choose.
export type ConfidentialityState = (
  | { status: "no_agreement"; activeVersionId: null }
  | { status: "unsigned"; activeVersionId: string }
  | { status: "signed"; activeVersionId: string }
) & { exempt: boolean };

/** Whether this state lets the user see the cycle's sensitive data. */
export function confidentialityCleared(state: ConfidentialityState): boolean {
  return state.exempt || state.status === "signed";
}

/** What's blocking the user from the cycle's data, or null when nothing is. */
export function confidentialityBlock(
  state: ConfidentialityState,
): "no_agreement" | "unsigned" | null {
  if (state.exempt || state.status === "signed") return null;
  return state.status;
}

export async function getCycleConfidentialityState(
  userId: string,
  cycleId: string,
): Promise<ConfidentialityState> {
  // Backed by the generalized document-signing tables: a confidentiality
  // agreement is a SigningDocument (kind Confidentiality) bound to the cycle via
  // a SigningBinding (scopeKey "cycle:<id>"), and a member signs it as a
  // SigningSignature (roleKey "member"). The public API here is unchanged so the
  // ~30 hiring gate call sites keep working.
  const [binding, signature, exempt] = await Promise.all([
    prisma.signingBinding.findFirst({
      where: { cycleId, document: { gateScope: "HiringCycle" } },
      select: { versionId: true },
    }),
    prisma.signingSignature.findFirst({
      where: {
        signerUserId: userId,
        roleKey: "member",
        binding: { cycleId, document: { gateScope: "HiringCycle" } },
      },
      select: { versionId: true },
    }),
    isCore(userId),
  ]);

  if (!binding) return { status: "no_agreement", activeVersionId: null, exempt };

  const activeVersionId = binding.versionId;
  if (signature && signature.versionId === activeVersionId) {
    return { status: "signed", activeVersionId, exempt };
  }
  return { status: "unsigned", activeVersionId, exempt };
}

/**
 * For loaders that protect a whole sensitive page: returns null when the
 * user has access (signed the bound version, or exempt), otherwise a redirect Response
 * pointing at the cycle's confidentiality page.
 */
export async function requirePageSignedOrRedirect(
  userId: string,
  cycleId: string,
  request: Request,
): Promise<Response | null> {
  const state = await getCycleConfidentialityState(userId, cycleId);
  if (confidentialityCleared(state)) return null;

  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return redirect(
    `/hiring/cycles/${cycleId}/confidentiality?next=${encodeURIComponent(next)}`,
  );
}

/**
 * For API routes / actions that touch sensitive data: returns null when the
 * user has access, otherwise a 403 JSON response naming the gate so the
 * client can prompt the user to sign.
 */
export async function requireApiSignedOrForbidden(
  userId: string,
  cycleId: string,
): Promise<Response | null> {
  const state = await getCycleConfidentialityState(userId, cycleId);
  if (confidentialityCleared(state)) return null;
  return Response.json(
    {
      error: "Confidentiality agreement required",
      reason: state.status,
      cycleId,
    },
    { status: 403 },
  );
}
