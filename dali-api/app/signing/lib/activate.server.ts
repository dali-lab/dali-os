// Put a published version "in force" for the current scope: upsert the binding,
// record the configured staff counter-signatures, and notify the audience.
// Extracted from the Drive agreement detail action so the agreements console can
// trigger the same one-click term rollover — one code path, no drift.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { resolveAdminScope } from "./scope.server";
import { applyAdminSignatures } from "./presign.server";
import { notifySignRequest } from "./notify.server";

export type ActivateResult = { ok: true; bindingId: string } | { error: string };

export async function activateVersion(opts: {
  documentId: string;
  versionId: string;
  userId: string;
  // Target term for PerTerm cadence (defaults to the current term). Lets the
  // staffing board issue a not-yet-started term's agreements early.
  termId?: string;
  request?: Request;
}): Promise<ActivateResult> {
  const { documentId, versionId, userId, termId, request } = opts;

  const version = await prisma.signingDocumentVersion.findUnique({
    where: { id: versionId },
    select: { publishedAt: true, body: true, documentId: true },
  });
  if (!version || version.documentId !== documentId) return { error: "Version not found." };
  if (!version.publishedAt) return { error: "Publish the version before putting it in force." };

  const doc = await prisma.signingDocument.findUniqueOrThrow({
    where: { id: documentId },
    select: { cadence: true },
  });
  const scope = await resolveAdminScope(doc, { termId });
  if ("error" in scope) return { error: scope.error };

  // One binding per (document, scopeKey): re-activating swaps the version.
  const bound = await prisma.signingBinding.upsert({
    where: { documentId_scopeKey: { documentId, scopeKey: scope.scopeKey } },
    create: {
      documentId,
      versionId,
      scopeKey: scope.scopeKey,
      termId: scope.termId ?? null,
      cycleId: scope.cycleId ?? null,
    },
    update: { versionId },
    select: { id: true },
  });
  // Record the pre-signed staff counter-signatures configured in the body.
  await applyAdminSignatures({ bindingId: bound.id, versionId, body: version.body });
  await logAuditEvent({
    action: "signing.bind",
    userId,
    targetId: documentId,
    metadata: { versionId, scopeKey: scope.scopeKey },
    request,
  });
  await notifySignRequest(bound.id);
  return { ok: true, bindingId: bound.id };
}
