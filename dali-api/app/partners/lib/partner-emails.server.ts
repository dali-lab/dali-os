import { sendEmail } from "~/lib/gmail";
import { getSender } from "~/lib/gmail-integration";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";

// All partner-facing mail goes through the lab's applications Gmail
// integration — the same sender hiring and education use. Recipients can be
// on any provider; nothing here requires the partner to have a Google
// account.
async function send(to: string, subject: string, html: string): Promise<void> {
  const sender = await getSender("Partners");
  if (!sender) {
    if (getAppEnv() !== "dev") {
      console.error("partner email skipped: applications Gmail not connected");
    }
    return;
  }
  await sendEmail({ refreshToken: sender.refreshToken, from: sender.sendAsEmail, to, subject, html });
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

const greeting = (name: string | null) => `<p>Hi ${name || "there"},</p>`;

// Sent after triage when the lab wants more information before deciding, or to
// communicate generic next steps.
export async function sendTriageNextStepsEmail(
  to: string,
  contactName: string | null,
  nextSteps: string,
): Promise<void> {
  await send(
    to,
    "Next steps on your DALI project inquiry",
    wrap(`
      ${greeting(contactName)}
      <p>Thanks for reaching out to the DALI Lab. Here's where things stand and what we'd like to do next:</p>
      <p style="white-space: pre-wrap;">${nextSteps}</p>
      <p style="color: #6b7280; font-size: 13px;">Just reply to this email with any questions.</p>
    `),
  );
}

// Sent when Core schedules/logs a discovery meeting with the partner.
export async function sendMeetingInviteEmail(
  to: string,
  contactName: string | null,
  when: string,
  details?: string,
): Promise<void> {
  await send(
    to,
    "Let's meet about your DALI project",
    wrap(`
      ${greeting(contactName)}
      <p>We'd love to meet to learn more about your project. We're proposing:</p>
      <p style="margin: 16px 0;"><strong>${when}</strong></p>
      ${details ? `<p style="white-space: pre-wrap;">${details}</p>` : ""}
      <p style="color: #6b7280; font-size: 13px;">Reply to confirm or suggest another time.</p>
    `),
  );
}

// Sent on an accept/promote decision.
export async function sendDecisionAcceptedEmail(
  to: string,
  contactName: string | null,
  projectName?: string,
): Promise<void> {
  await send(
    to,
    "Good news from the DALI Lab",
    wrap(`
      ${greeting(contactName)}
      <p>We're excited to move forward with your project${projectName ? ` — <strong>${projectName}</strong>` : ""}! Our team will be in touch shortly with next steps, including scope, timeline, and a Statement of Work.</p>
      <p style="color: #6b7280; font-size: 13px;">We're looking forward to working together.</p>
    `),
  );
}

// Sent on a reject decision. `reason` is optional partner-facing context.
export async function sendDecisionRejectedEmail(
  to: string,
  contactName: string | null,
  reason?: string,
): Promise<void> {
  await send(
    to,
    "An update on your DALI project inquiry",
    wrap(`
      ${greeting(contactName)}
      <p>Thank you for considering the DALI Lab and for taking the time to share your project with us. After careful review, we've decided not to move forward at this time.</p>
      ${reason ? `<p style="white-space: pre-wrap;">${reason}</p>` : ""}
      <p>We'd genuinely welcome hearing from you again in the future.</p>
    `),
  );
}

// Sent when the lab needs more information before it can decide ("learn more").
export async function sendLearnMoreRequestEmail(
  to: string,
  contactName: string | null,
  whatWeNeed: string,
): Promise<void> {
  await send(
    to,
    "A few questions about your DALI project",
    wrap(`
      ${greeting(contactName)}
      <p>We're interested in your project and would like to learn a bit more before we decide on next steps. Could you help us with the following?</p>
      <p style="white-space: pre-wrap;">${whatWeNeed}</p>
      <p style="color: #6b7280; font-size: 13px;">Just reply to this email — thank you!</p>
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
