import { redirect } from "react-router";
import { prisma } from "~/lib/db";

// Status of a user's confidentiality state for a given cycle.
//   no_agreement — hiring lead has not bound an agreement; nobody can see
//                  sensitive cycle data, including the hiring lead.
//   unsigned     — agreement is bound but this user has not signed the
//                  currently-bound version.
//   signed       — user has signed the currently-bound version.
export type ConfidentialityState =
  | { status: "no_agreement"; activeVersionId: null }
  | { status: "unsigned"; activeVersionId: string }
  | { status: "signed"; activeVersionId: string };

export async function getCycleConfidentialityState(
  userId: string,
  cycleId: string,
): Promise<ConfidentialityState> {
  // Backed by the generalized document-signing tables: a confidentiality
  // agreement is a SigningDocument (kind Confidentiality) bound to the cycle via
  // a SigningBinding (scopeKey "cycle:<id>"), and a member signs it as a
  // SigningSignature (roleKey "member"). The public API here is unchanged so the
  // ~30 hiring gate call sites keep working.
  const [binding, signature] = await Promise.all([
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
  ]);

  if (!binding) return { status: "no_agreement", activeVersionId: null };

  const activeVersionId = binding.versionId;
  if (signature && signature.versionId === activeVersionId) {
    return { status: "signed", activeVersionId };
  }
  return { status: "unsigned", activeVersionId };
}

/**
 * For loaders that protect a whole sensitive page: returns null when the
 * user has signed the currently-bound version, otherwise a redirect Response
 * pointing at the cycle's confidentiality page.
 */
export async function requirePageSignedOrRedirect(
  userId: string,
  cycleId: string,
  request: Request,
): Promise<Response | null> {
  const state = await getCycleConfidentialityState(userId, cycleId);
  if (state.status === "signed") return null;

  const url = new URL(request.url);
  const next = url.pathname + url.search;
  return redirect(
    `/hiring/cycles/${cycleId}/confidentiality?next=${encodeURIComponent(next)}`,
  );
}

/**
 * For API routes / actions that touch sensitive data: returns null when the
 * user has signed, otherwise a 403 JSON response naming the gate so the
 * client can prompt the user to sign.
 */
export async function requireApiSignedOrForbidden(
  userId: string,
  cycleId: string,
): Promise<Response | null> {
  const state = await getCycleConfidentialityState(userId, cycleId);
  if (state.status === "signed") return null;
  return Response.json(
    {
      error: "Confidentiality agreement required",
      reason: state.status,
      cycleId,
    },
    { status: 403 },
  );
}
