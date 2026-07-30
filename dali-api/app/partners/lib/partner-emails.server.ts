import { sendEmail } from "~/lib/gmail";
import { getSenderRefreshToken } from "~/lib/gmail-integration";
import { getAppEnv, getFrontendUrl } from "~/lib/app-env";

// Result of an outbound partner email. `ok: false` means the recipient did
// NOT get the mail (sender not connected in a real env, or the Gmail API
// threw) — callers surface this instead of showing a false "sent" state.
export type SendResult = { ok: true } | { ok: false; error: string };

// All partner-facing mail goes through the lab's applications Gmail
// integration — the same sender hiring and education use. Recipients can be
// on any provider; nothing here requires the partner to have a Google
// account.
async function send(
  to: string,
  subject: string,
  html: string,
  ics?: string,
): Promise<SendResult> {
  const refreshToken = await getSenderRefreshToken("Partners");
  if (!refreshToken) {
    // Dev routinely has no sender connected; callers log the link to the
    // console, so treat it as delivered rather than a user-facing failure.
    if (getAppEnv() === "dev") return { ok: true };
    console.error("partner email skipped: applications Gmail not connected");
    return { ok: false, error: "Email sender is not connected." };
  }
  try {
    await sendEmail({ refreshToken, to, subject, html, ics });
    return { ok: true };
  } catch (err) {
    console.error("partner email send failed", err);
    return { ok: false, error: "The email could not be sent." };
  }
}

const wrap = (body: string) => `
  <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    ${body}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      DALI Lab · Dartmouth College
    </p>
  </div>`;

// Brand CTA button (DALI dark-blue token — kept in sync with --color-dark-blue).
const cta = (url: string, label: string) => `
  <p style="margin: 24px 0;">
    <a href="${url}" style="background: #1E5779; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">${label}</a>
  </p>`;

export async function sendPartnerMagicLinkEmail(
  to: string,
  url: string,
): Promise<SendResult> {
  // sendEmail no-ops in dev; surface the link so the flow stays manually
  // testable without a mail sender.
  if (getAppEnv() === "dev") {
    console.info(`[partner-magic-link:dev] ${url}`);
  }
  return send(
    to,
    "Sign in to DALI OS",
    wrap(`
      <p>Use the button below to sign in to the DALI Lab partner portal. This link works once and expires in 15 minutes.</p>
      ${cta(url, "Sign in to DALI OS")}
      <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    `),
  );
}

export async function sendPartnerInviteEmail(
  to: string,
  orgName: string,
  inviterName: string | null,
  url: string,
): Promise<SendResult> {
  if (getAppEnv() === "dev") {
    console.info(`[partner-invite:dev] ${url}`);
  }
  const invitedBy = inviterName ? `${inviterName} invited you` : "You've been invited";
  return send(
    to,
    `You've been invited to join ${orgName} on DALI OS`,
    wrap(`
      <p>${invitedBy} to join <strong>${orgName}</strong> on DALI OS, the DALI Lab partner portal.</p>
      ${cta(url, "Accept invitation")}
      <p style="color: #6b7280; font-size: 13px;">This invitation expires in 7 days.</p>
    `),
  );
}

export async function sendMemberEmailConflictEmail(to: string): Promise<SendResult> {
  return send(
    to,
    "This email belongs to a DALI account",
    wrap(`
      <p>A partner-portal sign-in was requested for this address, but it's associated with an existing DALI account.</p>
      <p>If that was you: lab members and Dartmouth students sign in at the regular <a href="${getFrontendUrl()}/login">DALI OS sign-in page</a>. To create a separate partner account, use a different (work) email address.</p>
      <p style="color: #6b7280; font-size: 13px;">If you didn't request this, you can ignore this email.</p>
    `),
  );
}

// ─── Lifecycle notifications ────────────────────────────────────────────────
// A partner's pitch moved to a decision state. Best-effort: the caller fans
// this out to every teammate and never lets a send failure block the update.
export async function sendPartnerApplicationDecisionEmail(
  to: string,
  appTitle: string,
  status: "Accepted" | "Rejected" | "OnHold",
  decisionNote: string | null,
  viewUrl: string,
): Promise<SendResult> {
  const headline =
    status === "Accepted"
      ? `Your project pitch was accepted`
      : status === "OnHold"
        ? `Your project pitch is on hold`
        : `An update on your project pitch`;
  const lead =
    status === "Accepted"
      ? `Great news — <strong>${appTitle}</strong> was accepted. The DALI team will be in touch about next steps.`
      : status === "OnHold"
        ? `<strong>${appTitle}</strong> has been placed on hold while the lab weighs it against current capacity.`
        : `After review, the lab won't be moving forward with <strong>${appTitle}</strong> at this time.`;
  const note = decisionNote
    ? `<p style="background:#f3f4f6;border-radius:8px;padding:12px 14px;color:#374151;">${decisionNote}</p>`
    : "";
  return send(
    to,
    `${headline} — DALI OS`,
    wrap(`
      <p>${lead}</p>
      ${note}
      ${cta(viewUrl, "View application")}
    `),
  );
}

// A project was linked to the partner org (promoted from a pitch or attached
// by Core). The partner can now see it in the portal.
export async function sendPartnerProjectLinkedEmail(
  to: string,
  projectName: string,
  viewUrl: string,
): Promise<SendResult> {
  return send(
    to,
    `You've been added to ${projectName} on DALI OS`,
    wrap(`
      <p><strong>${projectName}</strong> is now available in your DALI partner portal — you can follow its roadmap, sprints, and shared docs there.</p>
      ${cta(viewUrl, "Open project")}
    `),
  );
}

// A page or file on a partnered project was shared with the partner org.
export async function sendPartnerDocumentSharedEmail(
  to: string,
  docTitle: string,
  projectName: string,
  viewUrl: string,
): Promise<SendResult> {
  return send(
    to,
    `New shared document on ${projectName}`,
    wrap(`
      <p>The team shared <strong>${docTitle}</strong> with you on <strong>${projectName}</strong>.</p>
      ${cta(viewUrl, "View in portal")}
    `),
  );
}

// A partnership on a project ended — the partner's access to it was revoked.
export async function sendPartnerPartnershipEndedEmail(
  to: string,
  projectName: string,
): Promise<SendResult> {
  return send(
    to,
    `Your access to ${projectName} has ended`,
    wrap(`
      <p>Your organization's partnership on <strong>${projectName}</strong> has ended, so it's no longer available in your DALI partner portal.</p>
      <p style="color: #6b7280; font-size: 13px;">If you think this is a mistake, reply to this email and we'll take a look.</p>
    `),
  );
}

// A meeting on a partnered project was shared with the partner. The `ics`
// attachment is a standard calendar invite (Google/Outlook/Apple add it and
// let the recipient RSVP from their own app — no partner login needed).
export async function sendPartnerMeetingSharedEmail(
  to: string,
  meetingTitle: string,
  projectName: string,
  when: string,
  viewUrl: string,
  ics: string,
): Promise<SendResult> {
  return send(
    to,
    `Meeting invite: ${meetingTitle} · ${projectName}`,
    wrap(`
      <p>The team scheduled <strong>${meetingTitle}</strong> on <strong>${projectName}</strong> and shared it with you.</p>
      <p style="color:#374151;">${when}</p>
      ${cta(viewUrl, "View & RSVP in portal")}
      <p style="color: #6b7280; font-size: 13px;">The attached invite adds it to your calendar; you can also RSVP from the portal.</p>
    `),
    ics,
  );
}

// A shared meeting was rescheduled or cancelled. `method` "CANCEL" removes it
// from the recipient's calendar; "REQUEST" updates the existing event.
export async function sendPartnerMeetingUpdatedEmail(
  to: string,
  meetingTitle: string,
  projectName: string,
  cancelled: boolean,
  when: string,
  viewUrl: string,
  ics: string,
): Promise<SendResult> {
  return send(
    to,
    `${cancelled ? "Cancelled" : "Updated"}: ${meetingTitle} · ${projectName}`,
    wrap(
      cancelled
        ? `<p><strong>${meetingTitle}</strong> on <strong>${projectName}</strong> has been cancelled. The attached update removes it from your calendar.</p>`
        : `
      <p><strong>${meetingTitle}</strong> on <strong>${projectName}</strong> has been rescheduled.</p>
      <p style="color:#374151;">${when}</p>
      ${cta(viewUrl, "View in portal")}
      <p style="color: #6b7280; font-size: 13px;">The attached update refreshes it on your calendar.</p>
    `,
    ),
    ics,
  );
}
