import { prisma } from "~/lib/db";
import { sendEmail } from "~/lib/gmail";
import { getApplicationsGmailRefreshToken } from "~/lib/gmail-integration";
import { resolveCandidateEmail, redirectBannerHtml } from "~/lib/candidate-email";

// The onboarding task points here; also used as the dedupe/clear key.
export const ONBOARDING_LINK = "/onboarding";

// Welcome a newly-promoted member: drop a persistent "finish onboarding" todo
// notification (links to /onboarding) and send a welcome email. Both are
// best-effort — a failure here must never block the acceptance/release that
// triggered it, so callers wrap this in try/catch (and it swallows its own
// email errors too).
//
// Idempotent: re-running creates another notification only if the member has no
// open onboarding todo, so a re-release won't spam them.

// Mark a member's onboarding task read so it drops out of their task list. Call
// this when onboarding is finished (onboardedAt set). Idempotent.
export async function clearOnboardingTask(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      recipientUserId: userId,
      kind: "SystemAnnouncement",
      link: ONBOARDING_LINK,
      readAt: null,
    },
    data: { readAt: new Date() },
  });
}

export async function sendWelcome(args: {
  userId: string;
  actorId: string;
  // For the email greeting + the address to send to. Email is skipped when null.
  firstName: string;
  email: string | null;
  // The member's newly-provisioned @dali.dartmouth.edu login email, if any —
  // folded into the welcome email so they know which account to log in with.
  daliEmail?: string | null;
}): Promise<{ notified: boolean; emailSent: boolean }> {
  // The onboarding task links to the /onboarding checklist (the profile form is
  // one step within it). It is a plain todo — NOT form-backed — so submitting
  // the profile form alone doesn't clear it; it stays until onboarding is fully
  // finished (clearOnboardingTask, called when onboardedAt is set).
  let notified = false;
  // Don't re-notify on a re-release: only create if there's no existing
  // onboarding todo for this member.
  const existing = await prisma.notification.findFirst({
    where: {
      recipientUserId: args.userId,
      kind: "SystemAnnouncement",
      link: ONBOARDING_LINK,
    },
    select: { id: true },
  });
  if (!existing) {
    await prisma.notification.create({
      data: {
        recipientUserId: args.userId,
        createdByUserId: args.actorId,
        kind: "SystemAnnouncement",
        title: "Welcome to DALI — finish onboarding",
        body: "Complete a few quick steps to finish setting up your account.",
        isTodo: true,
        link: ONBOARDING_LINK,
      },
    });
    notified = true;
  }

  let emailSent = false;
  try {
    // In dev/staging this is redirected to a test inbox (with a banner naming
    // the real intended recipient); in prod it goes to the member.
    const { to, redirectedFrom } = resolveCandidateEmail(args.email);
    if (to) {
      const refreshToken = await getApplicationsGmailRefreshToken();
      if (refreshToken) {
        const base = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
        await sendEmail({
          refreshToken,
          to,
          subject: "Welcome to the DALI Lab",
          html: welcomeHtml(
            args.firstName,
            `${base}${ONBOARDING_LINK}`,
            args.daliEmail ?? null,
            redirectedFrom,
          ),
        });
        emailSent = true;
      }
    }
  } catch (err) {
    // Best-effort: a welcome-email failure must not block release.
    console.error("Failed to send welcome email:", err);
  }

  return { notified, emailSent };
}

function welcomeHtml(
  firstName: string,
  onboardingUrl: string,
  daliEmail: string | null,
  // Non-prod only: the real recipient this email was redirected away from.
  redirectedFrom: string | null,
): string {
  const safeName = firstName || "there";
  const banner = redirectBannerHtml(redirectedFrom);
  const loginLine = daliEmail
    ? `<p>Your DALI account is ready. <strong>Log in to DALI OS with your new DALI email: ${daliEmail}</strong> (you'll be asked to set a password on first login).</p>`
    : `<p>Your DALI account is ready.</p>`;
  return `
    ${banner}
    <p>Hi ${safeName},</p>
    <p>Welcome to the DALI Lab!</p>
    ${loginLine}
    <p>Once you're in, finish setting up by completing your member profile and onboarding steps.</p>
    <p><a href="${onboardingUrl}">Complete your onboarding</a></p>
    <p>— The DALI Lab</p>
  `;
}
