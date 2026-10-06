// Partner contract: puts a Core-authored SigningDocument "in force" for one
// partner application and reads back its state. Built on the signing engine
// (app/signing/**) but deliberately NOT going through activateVersion/
// resolveAdminScope — those derive scopeKey from the document's cadence
// (app | term:<id> | cycle:<id>), and a partner contract needs a scopeKey
// keyed to the application instead (`partner-app:<id>`), one per application
// regardless of cadence. This does the same low-level binding upsert +
// admin-counter-signature step those use, just with that scopeKey.
//
// SigningDocument.kind is a narrow, additive re-introduction (the old
// kind/audience monolith was dropped before this feature — see
// SigningCadence's doc comment): PartnerContract is its only value today, set
// by Core when authoring a contract template so listPartnerContractDocuments
// has something precise to filter on instead of listing every agreement.

import { prisma } from "~/lib/db";
import { formatUsd } from "~/lib/money";
import { PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { applyAdminSignatures } from "~/signing/lib/presign.server";
import { logPartnerActivity } from "./partner-activity.server";
import { sendContractSentEmail } from "./partner-emails.server";
import { notifyPartners } from "./partner-notify.server";
import { getFrontendUrl } from "~/lib/app-env";

export type PartnerContractState = "NotSent" | "Sent" | "Signed";

export interface PartnerContractStatus {
  state: PartnerContractState;
  bindingId: string | null;
  signedAt: string | null;
  pdfUrl?: string;
}

/** Published, non-archived SigningDocuments flagged kind=PartnerContract — the
 * Select ContractPanel offers Core when sending a contract. */
export async function listPartnerContractDocuments(): Promise<{ id: string; title: string }[]> {
  const docs = await prisma.signingDocument.findMany({
    where: {
      kind: "PartnerContract",
      archivedAt: null,
      versions: { some: { publishedAt: { not: null } } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return docs.map((d) => ({ id: d.id, title: d.name }));
}

/** Read the current contract state for an application from its binding. */
export async function partnerContractStatus(applicationId: string): Promise<PartnerContractStatus> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: applicationId },
    select: { contractBindingId: true },
  });
  if (!app?.contractBindingId) {
    return { state: "NotSent", bindingId: null, signedAt: null };
  }
  const bindingId = app.contractBindingId;
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      versionId: true,
      signatures: {
        where: { roleKey: "member" },
        select: { versionId: true, signedAt: true },
      },
    },
  });
  if (!binding) return { state: "NotSent", bindingId: null, signedAt: null };

  const signature = binding.signatures.find((s) => s.versionId === binding.versionId);
  if (signature) {
    return {
      state: "Signed",
      bindingId,
      signedAt: signature.signedAt.toISOString(),
      pdfUrl: `/sign/${bindingId}/pdf`,
    };
  }
  return { state: "Sent", bindingId, signedAt: null };
}

/**
 * The {{...}} tokens a PartnerContract template can use (registered in the
 * "signing" context — see app/lib/template-variables.ts), resolved for one
 * application. Passed to SigningFillView for display and to recordSignature
 * so they're baked into the frozen signed copy.
 */
export async function resolvePartnerContractVariables(
  applicationId: string,
): Promise<Record<string, string>> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: applicationId },
    select: {
      title: true,
      fundingType: true,
      feeCents: true,
      legalEntityName: true,
      legalEntityAddress: true,
      applicantContact: { select: { name: true } },
      partnerOrg: { select: { name: true } },
      targetTerms: {
        orderBy: { term: { sortKey: "asc" } },
        select: { term: { select: { code: true } } },
      },
    },
  });
  if (!app) {
    return {
      partnerName: "",
      orgName: "",
      legalEntityName: "",
      legalEntityAddress: "",
      fee: "",
      fundingType: "",
      projectTitle: "",
      term: "",
    };
  }
  return {
    partnerName: app.applicantContact?.name ?? "",
    orgName: app.partnerOrg?.name ?? app.applicantContact?.name ?? "",
    legalEntityName: app.legalEntityName ?? "",
    legalEntityAddress: app.legalEntityAddress ?? "",
    fee: app.feeCents != null ? formatUsd(app.feeCents / 100) : "",
    fundingType: app.fundingType ? PROJECT_FUNDING_TYPE_LABELS[app.fundingType] : "",
    projectTitle: app.title,
    term: app.targetTerms.map((t) => t.term.code).join(", "),
  };
}

export type SendPartnerContractResult = { ok: true; bindingId: string } | { error: string };

/**
 * Put a SigningDocument's latest published version in force for one
 * application (scopeKey `partner-app:<id>`), store the binding, log + email.
 * Idempotent on re-send: swaps the binding's version and re-sends the email
 * (a partner who already signed an older version would need to re-sign the
 * swapped-in one — same "re-activating swaps the version" rule the engine
 * uses elsewhere).
 */
export async function sendPartnerContract(args: {
  applicationId: string;
  documentId: string;
  actorUserId: string;
}): Promise<SendPartnerContractResult> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: args.applicationId },
    select: { id: true, applicantContact: { select: { name: true, email: true } } },
  });
  if (!app) return { error: "Application not found." };

  const version = await prisma.signingDocumentVersion.findFirst({
    where: { documentId: args.documentId, publishedAt: { not: null } },
    orderBy: { versionNumber: "desc" },
    select: { id: true, body: true },
  });
  if (!version) return { error: "That document has no published version to send." };

  const scopeKey = `partner-app:${args.applicationId}`;
  const binding = await prisma.signingBinding.upsert({
    where: { documentId_scopeKey: { documentId: args.documentId, scopeKey } },
    create: { documentId: args.documentId, versionId: version.id, scopeKey },
    update: { versionId: version.id },
    select: { id: true },
  });
  await applyAdminSignatures({ bindingId: binding.id, versionId: version.id, body: version.body });

  await prisma.partnerApplication.update({
    where: { id: args.applicationId },
    data: { contractBindingId: binding.id },
  });

  await logPartnerActivity(prisma, {
    applicationId: args.applicationId,
    actorUserId: args.actorUserId,
    type: "ContractSent",
    metadata: { bindingId: binding.id, documentId: args.documentId },
  });

  if (app.applicantContact?.email) {
    const signUrl = `${getFrontendUrl()}/partner/applications/${args.applicationId}/sign-contract`;
    await sendContractSentEmail(app.applicantContact.email, app.applicantContact.name, signUrl);
  }

  return { ok: true, bindingId: binding.id };
}

/**
 * Called after a partner signs their contract (wrap recordSignature at the
 * call site in the portal sign-contract route — the engine has no generic
 * post-sign hook to attach to). Logs ContractSigned and fans the news out to
 * Core via notifyPartners("partner.contract_signed").
 */
export async function onPartnerContractSigned(args: {
  applicationId: string;
  bindingId: string;
}): Promise<void> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: args.applicationId },
    select: { title: true },
  });
  await logPartnerActivity(prisma, {
    applicationId: args.applicationId,
    type: "ContractSigned",
    metadata: { bindingId: args.bindingId },
  });
  await notifyPartners({
    eventType: "partner.contract_signed",
    title: `${app?.title ?? "A partner"} signed their contract`,
    link: `/core/partners/applications/${args.applicationId}`,
  });
}

/** Intent name: "contract-send". Fields: documentId. */
export async function handleContractIntent(
  formData: FormData,
  ctx: { applicationId: string; actorUserId: string },
): Promise<{ error: string } | { ok: true }> {
  const documentId = (formData.get("documentId") as string | null)?.trim() ?? "";
  if (!documentId) return { error: "Choose a document to send." };
  const result = await sendPartnerContract({
    applicationId: ctx.applicationId,
    documentId,
    actorUserId: ctx.actorUserId,
  });
  if ("error" in result) return { error: result.error };
  return { ok: true };
}
