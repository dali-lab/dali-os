// Fires the "document.sign_request" notification to everyone in a newly in-force
// agreement's audience. Called when an admin puts a version in force (and by the
// signing-issuance job when it materializes a new period's binding). Only
// app-enforced documents are notified proactively; hiring-cycle confidentiality
// is caught by its own gate (its resolver enumerates no one here).

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { type EmailAttachment } from "~/lib/gmail";
import { getFrontendUrl } from "~/lib/app-env";
import { isFeatureEnabledForEveryone } from "~/lib/feature-flags.server";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import type { PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";
import { AUDIENCE_RESOLVERS } from "./audiences";
import { getSignedCopyBody } from "./state.server";
import { enqueueOutbound, drainNow } from "~/lib/outbound.server";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "agreement";
}

// Emails the signer a "thank you for signing" receipt with a PDF copy of the
// completed agreement attached. A signing receipt is transactional — always
// wanted, and the PDF attachment needs the direct sendEmail path — so it sends
// directly rather than through notify()/preferences. Best-effort by contract:
// callers invoke it AFTER the signature is durably recorded and swallow errors,
// so a mail hiccup never fails the sign. sendEmail itself skips on dev and
// redirects to the test inbox on staging.
export async function sendSignatureReceipt(args: {
  signerUserId: string;
  bindingId: string;
  // Pins the receipt's dedup to the in-force version so a re-published version
  // sends a fresh receipt (and a deferred co-signed receipt isn't shadowed by
  // an earlier version's). Optional for back-compat.
  versionId?: string;
  documentName: string;
  frozenBody: unknown;
}): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: args.signerUserId },
    select: {
      firstName: true,
      daliEmail: true,
      dartmouthEmail: true,
      personalEmail: true,
      netId: true,
    },
  });
  if (!user) return;
  // Same address chain as the notify() email path (netId fallback covers portal
  // students who have no daliEmail).
  const to =
    user.daliEmail ??
    user.dartmouthEmail ??
    user.personalEmail ??
    (user.netId ? `${user.netId}@dartmouth.edu` : null);
  if (!to) return;

  // Render the frozen archival body to a PDF copy. If it fails, still send the
  // thank-you (with a link) rather than nothing.
  let attachments: EmailAttachment[] | undefined;
  try {
    const pdf = await renderDocumentPdf(
      args.documentName,
      args.frozenBody as PMNode | DocBlock[],
    );
    attachments = [
      { filename: `${safeFilename(args.documentName)}.pdf`, mimeType: "application/pdf", content: pdf },
    ];
  } catch (err) {
    console.error("[signing] receipt PDF render failed:", err);
  }

  const name = escapeHtml(args.documentName);
  const link = `${getFrontendUrl()}/sign/${args.bindingId}`;
  const html = [
    `<p>Hi ${escapeHtml(user.firstName)},</p>`,
    `<p>Thanks for signing <strong>${name}</strong>. ${
      attachments
        ? "A copy of your signed agreement is attached to this email"
        : "Your signed agreement is available online"
    }, and it's always available in DALI OS.</p>`,
    `<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#18181b;color:#ffffff;text-decoration:none;border-radius:6px;">View signed copy</a></p>`,
    `<p style="color:#71717a;font-size:12px;">— DALI OS</p>`,
  ].join("\n");

  const { id } = await enqueueOutbound({
    channel: "email",
    purpose: "General",
    dedupKey: `signing.receipt:${args.bindingId}:${args.versionId ?? "x"}:${args.signerUserId}`,
    target: to,
    recipientUserId: args.signerUserId,
    subject: `Signed: ${args.documentName}`,
    bodyHtml: html,
    attachments,
    eventType: "signing.receipt",
  });
  await drainNow([id]);
}

// Send the "please sign" notification to a binding's outstanding signers.
//
// By DEFAULT this skips members already notified for THIS binding + in-force
// version, so re-issuing a term's agreements (e.g. after finalizing more teams)
// doesn't re-nudge members who were already asked and just haven't signed yet —
// only newly-added, still-unsigned members are reached. A NEW version in force
// has a different versionId, so its notified-set is empty and everyone is asked
// to re-sign. Pass { force: true } to re-nudge everyone outstanding regardless
// (the agreements console "remind" action does this on purpose).
export async function notifySignRequest(
  bindingId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      termId: true,
      document: {
        select: { name: true, gateScope: true, audience: true, audienceGroupId: true },
      },
    },
  });
  if (!binding) return;
  if (binding.document.gateScope !== "App") return;

  // The document's audience, minus anyone who already signed the in-force version.
  const [audience, signed] = await Promise.all([
    AUDIENCE_RESOLVERS[binding.document.audience].listMembers({
      termId: binding.termId ?? undefined,
      audienceGroupId: binding.document.audienceGroupId,
    }),
    prisma.signingSignature.findMany({
      where: { bindingId, roleKey: "member", versionId: binding.versionId },
      select: { signerUserId: true },
    }),
  ]);
  const signedSet = new Set(signed.map((s) => s.signerUserId));
  const eligible = audience.filter((p) => !signedSet.has(p.id));
  if (eligible.length === 0) return;

  // Idempotency is the notify() dedupKey. A per-(binding, version, signer)
  // forever key means re-issuing a term's agreements no-ops for members already
  // notified for the in-force version, while a NEW version in force (different
  // versionId) reaches everyone afresh. force → no key, so the console "remind"
  // re-nudges everyone still outstanding. (Replaced the SignRequestNotification
  // ledger, which did exactly this dedup.)
  await notify({
    eventType: "document.sign_request",
    message: {
      title: "You have a new document to sign",
      body: binding.document.name,
      link: `/sign/${bindingId}`,
      isTodo: true,
    },
    recipients: eligible.map((p) => ({
      userId: p.id,
      dedupKey: opts.force
        ? null
        : `signing.request:${bindingId}:${binding.versionId}:${p.id}`,
    })),
  });
}

// Ask a mentor's mentees to countersign the mentorship agreement the mentor
// just signed. Fired fire-and-forget from the sign action AFTER a mentor's
// signature is recorded (never from recordSignature itself — that's shared with
// MCP + the mentee's own sign). Idempotent: a per-(binding, version, mentee)
// forever dedupKey means a SECOND mentor signing later doesn't re-nudge a mentee
// already asked, and mentees who've already countersigned the in-force version
// are filtered out. No-op unless the feature is live and the document opts in.
export async function notifyCountersignRequest(
  bindingId: string,
  mentorUserId: string,
): Promise<void> {
  if (!(await isFeatureEnabledForEveryone("mentee-countersign"))) return;

  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      id: true,
      versionId: true,
      termId: true,
      document: { select: { name: true, gateScope: true, requiresMenteeCountersign: true } },
    },
  });
  if (!binding || !binding.termId) return;
  if (binding.document.gateScope !== "App" || !binding.document.requiresMenteeCountersign) return;

  const [pairs, countersigned] = await Promise.all([
    prisma.mentorshipPair.findMany({
      where: { mentorUserId, termId: binding.termId },
      select: { menteeUserId: true },
    }),
    prisma.signingSignature.findMany({
      where: { bindingId, roleKey: "mentee", versionId: binding.versionId },
      select: { signerUserId: true },
    }),
  ]);
  const done = new Set(countersigned.map((s) => s.signerUserId));
  const menteeIds = [...new Set(pairs.map((p) => p.menteeUserId))].filter((id) => !done.has(id));
  if (menteeIds.length === 0) return;

  await notify({
    eventType: "document.countersign_request",
    message: {
      title: "Countersign your mentorship agreement",
      body: binding.document.name,
      link: `/sign/${bindingId}`,
      isTodo: true,
    },
    recipients: menteeIds.map((userId) => ({
      userId,
      dedupKey: `countersign.request:${bindingId}:${binding.versionId}:${userId}`,
    })),
  });
}

// Send the fully co-signed receipt to a mentee who just countersigned AND to
// each of their mentors who has signed the in-force version — the mentor's
// deferred receipt, now that both signatures exist. Every recipient's PDF is
// composed via getSignedCopyBody so it shows both parties. Fire-and-forget;
// sendSignatureReceipt dedups per (binding, version, recipient), so a mentor
// with several mentees is emailed once (on the first countersignature). No-op
// unless the document opts in.
export async function sendCoSignedReceipts(
  bindingId: string,
  menteeUserId: string,
): Promise<void> {
  const binding = await prisma.signingBinding.findUnique({
    where: { id: bindingId },
    select: {
      versionId: true,
      termId: true,
      document: { select: { name: true, requiresMenteeCountersign: true } },
    },
  });
  if (!binding || !binding.document.requiresMenteeCountersign) return;
  const documentName = binding.document.name;

  const send = async (userId: string, roleKey: string) => {
    const body = await getSignedCopyBody(bindingId, userId, roleKey);
    if (body == null) return;
    await sendSignatureReceipt({
      signerUserId: userId,
      bindingId,
      versionId: binding.versionId,
      documentName,
      frozenBody: body,
    });
  };

  // The mentee's own co-signed copy.
  await send(menteeUserId, "mentee").catch((err) =>
    console.error("[signing] mentee co-signed receipt failed:", err),
  );

  // Their mentor(s) who have already signed the in-force version.
  if (!binding.termId) return;
  const pairs = await prisma.mentorshipPair.findMany({
    where: { menteeUserId, termId: binding.termId },
    select: { mentorUserId: true },
  });
  const mentorIds = [...new Set(pairs.map((p) => p.mentorUserId))];
  if (mentorIds.length === 0) return;
  const signedMentors = await prisma.signingSignature.findMany({
    where: {
      bindingId,
      roleKey: "member",
      versionId: binding.versionId,
      signerUserId: { in: mentorIds },
    },
    select: { signerUserId: true },
  });
  for (const m of signedMentors) {
    await send(m.signerUserId, "member").catch((err) =>
      console.error("[signing] mentor co-signed receipt failed:", err),
    );
  }
}
