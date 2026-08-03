import { sendEmail } from "~/lib/gmail";
import { getSenderRefreshToken } from "~/lib/gmail-integration";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";
import { prisma } from "~/lib/db";

// All partner-facing mail goes through the lab's applications Gmail
// integration — the same sender hiring and education use. Recipients can be
// on any provider; nothing here requires the partner to have a Google
// account.
async function send(to: string, subject: string, html: string): Promise<void> {
  const refreshToken = await getSenderRefreshToken("Partners");
  if (!refreshToken) {
    if (getAppEnv() !== "dev") {
      console.error("partner email skipped: applications Gmail not connected");
    }
    return;
  }
  await sendEmail({ refreshToken, to, subject, html });
}

const wrap = (body: string) => `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    ${body}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`;

export async function sendPartnerMagicLinkEmail(
  to: string,
  url: string,
): Promise<void> {
  // sendEmail no-ops in dev; surface the link so the flow stays manually
  // testable without a mail sender.
  if (getAppEnv() === "dev") {
    console.info(`[partner-magic-link:dev] ${url}`);
  }
  await send(
    to,
    "Sign in to DALI OS",
    wrap(`
      <p>Use the button below to sign in to the DALI Lab partner portal. This link works once and expires in 15 minutes.</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Sign in to DALI OS</a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    `),
  );
}

export async function sendPartnerInviteEmail(
  to: string,
  orgName: string,
  inviterName: string | null,
  url: string,
): Promise<void> {
  if (getAppEnv() === "dev") {
    console.info(`[partner-invite:dev] ${url}`);
  }
  const invitedBy = inviterName ? `${inviterName} invited you` : "You've been invited";
  await send(
    to,
    `You've been invited to join ${orgName} on DALI OS`,
    wrap(`
      <p>${invitedBy} to join <strong>${orgName}</strong> on DALI OS, the DALI Lab partner portal.</p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background: #1e3a8a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Accept invitation</a>
      </p>
      <p style="color: #6b7280; font-size: 13px;">This invitation expires in 7 days.</p>
    `),
  );
}

// ── Application lifecycle notifications ──────────────────────────────────────
// The partner portal is otherwise pull-only; these push the moments a partner
// actually needs to act on (a decision, a SOW to review, a contract to sign) to
// their inbox with a deep link. Direct per-feature pipeline (Partners Gmail),
// outside the member notify() preference layer — same as invites above.

type PartnerAppEvent =
  | { kind: "accepted" }
  | { kind: "rejected" }
  | { kind: "onhold" }
  | { kind: "sow-shared" }
  | { kind: "contract-sent" }
  | { kind: "contract-signed"; signerName: string };

const cta = (href: string, label: string) =>
  `<p style="margin: 24px 0;"><a href="${href}" style="background: #ff595a; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">${label}</a></p>`;

function eventCopy(
  event: PartnerAppEvent,
  title: string,
  link: string,
  pdfLink: string,
): { subject: string; body: string } {
  switch (event.kind) {
    case "accepted":
      return {
        subject: `Good news about "${title}"`,
        body: `<p>We'd love to work with you on <strong>${title}</strong>. The DALI team will be in touch about next steps.</p>${cta(link, "View your application")}`,
      };
    case "rejected":
      return {
        subject: `An update on "${title}"`,
        body: `<p>Thank you for your interest in the DALI Lab. After review, we won't be able to take on <strong>${title}</strong> right now. We're grateful you thought of us, and we'd welcome future ideas.</p>${cta(link, "View your application")}`,
      };
    case "onhold":
      return {
        subject: `An update on "${title}"`,
        body: `<p>We're holding <strong>${title}</strong> for now — often a timing question. We'll be in touch, and you can check status any time.</p>${cta(link, "View your application")}`,
      };
    case "sow-shared":
      return {
        subject: `A statement of work is ready for your feedback`,
        body: `<p>The DALI team has shared a draft statement of work for <strong>${title}</strong>. Review it and add your thoughts — you can edit it together right in the portal.</p>${cta(link, "Review the statement of work")}`,
      };
    case "contract-sent":
      return {
        subject: `Your DALI contract is ready to sign`,
        body: `<p>The contract for <strong>${title}</strong> is ready. Review it and sign online when you're ready.</p>${cta(link, "Review and sign")}`,
      };
    case "contract-signed":
      return {
        subject: `Your signed DALI contract`,
        body: `<p>Thanks, ${event.signerName}. Your contract for <strong>${title}</strong> is signed. A copy is attached below for your records.</p>${cta(pdfLink, "Download signed contract (PDF)")}`,
      };
  }
}

// Load the people to tell for an application (the applicant + any org members),
// build the message, and send. No-ops safely in dev (see send()).
export async function notifyPartnerApplicationEvent(
  applicationId: string,
  event: PartnerAppEvent,
): Promise<void> {
  const app = await prisma.partnerApplication.findUnique({
    where: { id: applicationId },
    select: {
      title: true,
      applicant: { select: { personalEmail: true } },
      partnerOrg: {
        select: { users: { select: { user: { select: { personalEmail: true } } } } },
      },
    },
  });
  if (!app) return;
  const recipients = [
    ...new Set(
      [
        app.applicant?.personalEmail,
        ...(app.partnerOrg?.users.map((u) => u.user.personalEmail) ?? []),
      ]
        .filter((e): e is string => !!e)
        .map((e) => e.toLowerCase()),
    ),
  ];
  if (recipients.length === 0) return;

  const base = getFrontendUrl();
  const link = `${base}/partner/applications/${applicationId}`;
  const pdfLink = `${base}/partner/applications/${applicationId}/contract.pdf`;
  const { subject, body } = eventCopy(event, app.title, link, pdfLink);
  for (const to of recipients) {
    await send(to, subject, wrap(body));
  }
}

export async function sendMemberEmailConflictEmail(to: string): Promise<void> {
  await send(
    to,
    "This email belongs to a DALI account",
    wrap(`
      <p>A partner-portal sign-in was requested for this address, but it's associated with an existing DALI account.</p>
      <p>If that was you: lab members and Dartmouth students sign in at the regular <a href="${getFrontendUrl()}/login">DALI OS sign-in page</a>. To create a separate partner account, use a different (work) email address.</p>
      <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    `),
  );
}
