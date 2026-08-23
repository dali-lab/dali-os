// Fires the "document.sign_request" notification to everyone in a newly in-force
// agreement's audience. Called when an admin puts a version in force (and by the
// signing-issuance job when it materializes a new period's binding). Only
// app-enforced documents are notified proactively; hiring-cycle confidentiality
// is caught by its own gate (its resolver enumerates no one here).

import { prisma } from "~/lib/db";
import { notify } from "~/lib/notify.server";
import { sendEmail, type EmailAttachment } from "~/lib/gmail";
import { getSender } from "~/lib/gmail-integration";
import { getFrontendUrl } from "~/lib/app-env";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import type { PMNode } from "~/collab/export-html";
import type { DocBlock } from "~/collab/blocknote-server";
import { AUDIENCE_RESOLVERS } from "./audiences";

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

  const sender = await getSender("General").catch(() => null);
  if (!sender) return;

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

  await sendEmail({
    refreshToken: sender.refreshToken,
    from: sender.sendAsEmail,
    to,
    subject: `Signed: ${args.documentName}`,
    html,
    attachments,
  });
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
  let eligible = audience.filter((p) => !signedSet.has(p.id));

  // Unless forcing, drop members already notified for this binding+version.
  if (!opts.force && eligible.length > 0) {
    const already = await prisma.signRequestNotification.findMany({
      where: {
        bindingId,
        versionId: binding.versionId,
        signerUserId: { in: eligible.map((p) => p.id) },
      },
      select: { signerUserId: true },
    });
    const alreadySet = new Set(already.map((r) => r.signerUserId));
    eligible = eligible.filter((p) => !alreadySet.has(p.id));
  }
  if (eligible.length === 0) return;

  await notify({
    eventType: "document.sign_request",
    message: {
      title: "You have a new document to sign",
      body: binding.document.name,
      link: `/sign/${bindingId}`,
      isTodo: true,
    },
    recipients: eligible.map((p) => ({ userId: p.id })),
  });

  // Record who we just notified so a later re-issue skips them. Idempotent via
  // the (bindingId, versionId, signerUserId) unique constraint; best-effort —
  // a tracking-write failure must not fail the notification already sent.
  await prisma.signRequestNotification
    .createMany({
      data: eligible.map((p) => ({
        bindingId,
        versionId: binding.versionId,
        signerUserId: p.id,
      })),
      skipDuplicates: true,
    })
    .catch((err) => console.error("[signing] sign-request tracking write failed:", err));
}
