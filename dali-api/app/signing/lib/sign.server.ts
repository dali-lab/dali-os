// Records a member's signature on a binding: writes the SigningSignature row
// with captured field values + a frozen archival body (values + resolved
// variables baked in), captures ip/user-agent, and audit-logs. Generalizes the
// confidentiality sign upsert.

import { prisma } from "~/lib/db";
import { logAuditEvent } from "~/lib/audit";
import { getClientIp } from "~/lib/request-meta";
import { fullName } from "~/lib/display";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { bakeSigningBody, collectSigningFields } from "~/lib/signing-fields";
import { resolveSigningVariablesForSigner } from "./variables.server";
import { sendSignatureReceipt } from "./notify.server";

export interface RecordSignatureArgs {
  bindingId: string;
  signerUserId: string;
  fieldValues: Record<string, unknown>;
  request: Request;
}

export type RecordSignatureResult =
  | { ok: true }
  | { ok: false; error: string };

export async function recordSignature(
  args: RecordSignatureArgs,
): Promise<RecordSignatureResult> {
  const binding = await prisma.signingBinding.findUnique({
    where: { id: args.bindingId },
    select: {
      id: true,
      versionId: true,
      version: { select: { body: true } },
      document: { select: { name: true } },
    },
  });
  if (!binding) return { ok: false, error: "Agreement not found." };

  // Normalize the in-force body to block JSON first (legacy ProseMirror
  // version rows convert on read; fieldIds survive conversion 1:1) so every
  // NEW frozen snapshot is block JSON. Existing frozenBody rows are never
  // touched — they render via the legacy PM walker forever.
  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);

  // Validate every required field for the member role is filled.
  for (const f of fields) {
    if (f.role !== "member" || !f.required) continue;
    const v = args.fieldValues[f.fieldId];
    const filled =
      f.type === "checkboxField" ? v === true || v === "true" : v != null && String(v).trim() !== "";
    if (!filled) return { ok: false, error: "Please complete all required fields before signing." };
  }

  // The typed-name affirmation is the member's signature/initial field value;
  // fall back to their known name so the record is never blank.
  const sigField = fields.find(
    (f) => f.role === "member" && (f.type === "signatureField" || f.type === "initialField"),
  );
  let typedName = sigField ? String(args.fieldValues[sigField.fieldId] ?? "").trim() : "";
  if (!typedName) {
    const u = await prisma.user.findUnique({
      where: { id: args.signerUserId },
      select: { firstName: true, lastName: true },
    });
    typedName = u ? fullName(u) : "";
  }

  const variables = await resolveSigningVariablesForSigner(args.signerUserId);
  const frozenBody = bakeSigningBody(body, {
    fieldValues: args.fieldValues,
    variables,
  });

  await prisma.signingSignature.upsert({
    where: {
      bindingId_signerUserId_roleKey: {
        bindingId: args.bindingId,
        signerUserId: args.signerUserId,
        roleKey: "member",
      },
    },
    create: {
      bindingId: args.bindingId,
      versionId: binding.versionId,
      signerUserId: args.signerUserId,
      roleKey: "member",
      typedName,
      ip: getClientIp(args.request) ?? null,
      userAgent: args.request.headers.get("user-agent") || null,
      fieldValues: args.fieldValues as object,
      frozenBody: frozenBody as object,
    },
    update: {
      versionId: binding.versionId,
      signedAt: new Date(),
      typedName,
      ip: getClientIp(args.request) ?? null,
      userAgent: args.request.headers.get("user-agent") || null,
      fieldValues: args.fieldValues as object,
      frozenBody: frozenBody as object,
    },
  });

  await logAuditEvent({
    action: "signing.sign",
    userId: args.signerUserId,
    targetId: args.bindingId,
    metadata: { versionId: binding.versionId },
    request: args.request,
  });

  // Email the signer a thank-you with a PDF copy attached. The signature is
  // already durably recorded, so a mail failure must not fail the sign.
  await sendSignatureReceipt({
    signerUserId: args.signerUserId,
    bindingId: args.bindingId,
    documentName: binding.document.name,
    frozenBody,
  }).catch((err) => console.error("[signing] receipt send failed:", err));

  return { ok: true };
}
