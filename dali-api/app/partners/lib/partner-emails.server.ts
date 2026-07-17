import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";

// All partner-facing mail goes through the lab's applications Gmail
// integration — the same sender hiring and education use. Recipients can be
// on any provider; nothing here requires the partner to have a Google
// account.
async function send(to: string, subject: string, html: string): Promise<void> {
  const refreshToken = await getApplicationsGmailRefreshToken();
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
