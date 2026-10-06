import { enqueueOutbound, drainNow } from "~/lib/outbound.server";
import { getFrontendUrl } from "~/lib/app-env";
import { escapeHtml, htmlToPlainText } from "~/lib/email";
import { renderFramedEmail } from "~/email/lib/layout.server";

// All partner-facing mail goes through the outbox as the Partners Gmail
// identity (resolved at drain — retry, per-sender cap, and history come with
// it). Recipients can be on any provider; nothing here requires the partner to
// have a Google account.
//
// Every body is composed here and framed by the shared layout. Two things changed
// when that landed, both correctness rather than style and both applying whether
// or not the `email-layout` flag is on:
//
//  * Interpolated values are escaped. Contact names, org names and the free-text
//    blocks an operator types in the triage/reject/learn-more modals were spliced
//    into markup raw, so an ampersand or a stray "<" broke rendering.
//  * Each email carries a plain-text part, derived from its own body.
//
// The operator-typed blocks keep `white-space: pre-wrap` so their line breaks
// survive, which is why they are escaped rather than converted to <p> runs.

async function send(
  to: string,
  parts: { subject: string; bodyHtml: string; preheader: string; cta?: { href: string; label: string } },
  opts: { dedupKey?: string | null; eventType?: string } = {},
): Promise<void> {
  const mail = await renderFramedEmail(
    { ...parts, text: htmlToPlainText(parts.bodyHtml) },
    { footer: "transactional" },
  );
  const { id } = await enqueueOutbound({
    channel: "email",
    purpose: "Partners",
    dedupKey: opts.dedupKey ?? null,
    target: to,
    subject: mail.subject,
    bodyHtml: mail.html,
    bodyText: mail.text,
    eventType: opts.eventType ?? "partner.email",
  });
  await drainNow([id]);
}

const greeting = (name: string | null) =>
  `<p style="margin:0 0 16px;">Hi ${name ? escapeHtml(name) : "there"},</p>`;

// An operator-typed block: escaped, but with its line breaks preserved.
const typed = (text: string) =>
  `<p style="margin:0 0 16px;white-space:pre-wrap;">${escapeHtml(text)}</p>`;

const aside = (text: string) =>
  `<p style="margin:0;color:#52525b;font-size:14px;">${text}</p>`;

// Sent after triage when the lab wants more information before deciding, or to
// communicate generic next steps.
export async function sendTriageNextStepsEmail(
  to: string,
  contactName: string | null,
  nextSteps: string,
): Promise<void> {
  await send(
    to,
    {
      subject: "Next steps on your DALI project inquiry",
      preheader: "Where your project inquiry stands and what happens next.",
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">Thanks for reaching out to the DALI Lab. Here's where things stand and what we'd like to do next:</p>`,
        typed(nextSteps),
        aside("Just reply to this email with any questions."),
      ].join("\n"),
    },
    { eventType: "partner.triage" },
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
    {
      subject: "Let's meet about your DALI project",
      preheader: `Proposed time: ${when}`,
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">We'd love to meet to learn more about your project. We're proposing:</p>`,
        `<p style="margin:0 0 16px;"><strong>${escapeHtml(when)}</strong></p>`,
        details ? typed(details) : "",
        aside("Reply to confirm or suggest another time."),
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { eventType: "partner.meeting_invite" },
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
    {
      subject: "Good news from the DALI Lab",
      preheader: "We're moving forward with your project.",
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">We're excited to move forward with your project${
          projectName ? `, <strong>${escapeHtml(projectName)}</strong>` : ""
        }. Our team will be in touch shortly with next steps, including scope, timeline, and a Statement of Work.</p>`,
        aside("We're looking forward to working together."),
      ].join("\n"),
    },
    { eventType: "partner.decision.accepted" },
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
    {
      subject: "An update on your DALI project inquiry",
      preheader: "An update on the project you shared with us.",
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">Thank you for considering the DALI Lab and for taking the time to share your project with us. After careful review, we've decided not to move forward at this time.</p>`,
        reason ? typed(reason) : "",
        `<p style="margin:0;">We'd genuinely welcome hearing from you again in the future.</p>`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { eventType: "partner.decision.rejected" },
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
    {
      subject: "A few questions about your DALI project",
      preheader: "A few questions before we decide on next steps.",
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">We're interested in your project and would like to learn a bit more before we decide on next steps. Could you help us with the following?</p>`,
        typed(whatWeNeed),
        aside("Just reply to this email, and thank you."),
      ].join("\n"),
    },
    { eventType: "partner.learn_more" },
  );
}

// Sent when a partner submits the project-inquiry form.
//
// NEW outbound mail, not a restyling of something existing: submitting the form
// used to notify the form's creator and tell the applicant nothing, so a partner
// got silence until someone triaged them. Keyed on the application so a double
// submit can't double-confirm.
export async function sendApplicationReceivedEmail(
  to: string,
  contactName: string | null,
  applicationId: string,
): Promise<void> {
  await send(
    to,
    {
      subject: "We got your DALI project inquiry",
      preheader: "Your project inquiry reached the DALI Lab.",
      bodyHtml: [
        greeting(contactName),
        `<p style="margin:0 0 16px;">Thanks for telling us about your project. Your inquiry is in front of the DALI Lab team now.</p>`,
        `<p style="margin:0 0 16px;">We review inquiries as they come in and will be in touch with next steps. If we need anything else to understand the project, we'll ask.</p>`,
        aside("You can reply to this email with anything you'd like to add."),
      ].join("\n"),
    },
    {
      dedupKey: `partner.application.received:${applicationId}`,
      eventType: "partner.application_received",
    },
  );
}

export async function sendMemberEmailConflictEmail(to: string): Promise<void> {
  const loginUrl = `${getFrontendUrl()}/login`;
  await send(
    to,
    {
      subject: "This email belongs to a DALI account",
      preheader: "Sign in at the regular DALI OS page instead.",
      bodyHtml: [
        `<p style="margin:0 0 16px;">A partner-portal sign-in was requested for this address, but it's associated with an existing DALI account.</p>`,
        `<p style="margin:0 0 16px;">If that was you: lab members and Dartmouth students sign in at the regular <a href="${escapeHtml(loginUrl)}">DALI OS sign-in page</a>. To create a separate partner account, use a different work email address.</p>`,
        aside("If you didn't request this, you can ignore this email."),
      ].join("\n"),
    },
    { eventType: "partner.member_conflict" },
  );
}
