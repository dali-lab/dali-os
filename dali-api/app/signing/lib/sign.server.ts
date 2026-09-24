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
  // Which party's slot this signature fills. "member" is the primary signer
  // (a member / mentor); "mentee" is a mentee countersigning a mentorship
  // agreement. Validation + the sig field lookup key off this role, and the
  // row is written under it — the @@unique([bindingId, signerUserId, roleKey])
  // keeps one signature per (binding, signer, role). Defaults to "member" so
  // every existing caller is unchanged.
  roleKey?: string;
  // Whether to email the signer their thank-you receipt now. Defaults true.
  // The co-signed mentorship flow passes false so the route can defer the
  // mentor's receipt until the mentee countersigns and send both parties the
  // fully co-signed copy instead of a half-signed one.
  sendReceipt?: boolean;
}

export type RecordSignatureResult =
  | { ok: true }
  | { ok: false; error: string };

export async function recordSignature(
  args: RecordSignatureArgs,
): Promise<RecordSignatureResult> {
  const roleKey = args.roleKey ?? "member";
  const binding = await prisma.signingBinding.findUnique({
    where: { id: args.bindingId },
    select: {
      id: true,
      versionId: true,
      version: { select: { body: true } },
      document: { select: { name: true } },
      term: { select: { code: true } },
    },
  });
  if (!binding) return { ok: false, error: "Agreement not found." };

  // Normalize the in-force body to block JSON first (legacy ProseMirror
  // version rows convert on read; fieldIds survive conversion 1:1) so every
  // NEW frozen snapshot is block JSON. Existing frozenBody rows are never
  // touched — they render via the legacy PM walker forever.
  const body = ensureBlocks(binding.version.body);
  const fields = collectSigningFields(body);

  // Validate every required field for the acting role is filled.
  for (const f of fields) {
    if (f.role !== roleKey || !f.required) continue;
    const v = args.fieldValues[f.fieldId];
    const filled =
      f.type === "checkboxField" ? v === true || v === "true" : v != null && String(v).trim() !== "";
    if (!filled) return { ok: false, error: "Please complete all required fields before signing." };
  }

  // The typed-name affirmation is the signer's signature/initial field value;
  // fall back to their known name so the record is never blank.
  const sigField = fields.find(
    (f) => f.role === roleKey && (f.type === "signatureField" || f.type === "initialField"),
  );
  let typedName = sigField ? String(args.fieldValues[sigField.fieldId] ?? "").trim() : "";
  if (!typedName) {
    const u = await prisma.user.findUnique({
      where: { id: args.signerUserId },
      select: { firstName: true, lastName: true },
    });
    typedName = u ? fullName(u) : "";
  }

  const variables = await resolveSigningVariablesForSigner(args.signerUserId, {
    termCode: binding.term?.code ?? undefined,
  });
  const frozenBody = bakeSigningBody(body, {
    fieldValues: args.fieldValues,
    variables,
  });

  await prisma.signingSignature.upsert({
    where: {
      bindingId_signerUserId_roleKey: {
        bindingId: args.bindingId,
        signerUserId: args.signerUserId,
        roleKey,
      },
    },
    create: {
      bindingId: args.bindingId,
      versionId: binding.versionId,
      signerUserId: args.signerUserId,
      roleKey,
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

  // Email the signer a thank-you with a PDF copy attached — FIRE-AND-FORGET.
  // The signature is already durably recorded, and rendering the PDF (headless
  // Chromium) + sending the mail can take a couple seconds; the signer must not
  // wait on it. Runs in the background on the persistent server; errors are
  // logged, never surfaced (a receipt failure never fails the sign). Skipped
  // when the caller defers it (co-signed mentorship receipts, sent once both
  // parties have signed).
  if (args.sendReceipt ?? true) {
    void sendSignatureReceipt({
      signerUserId: args.signerUserId,
      bindingId: args.bindingId,
      versionId: binding.versionId,
      documentName: binding.document.name,
      frozenBody,
    }).catch((err) => console.error("[signing] receipt send failed:", err));
  }

  return { ok: true };
}
