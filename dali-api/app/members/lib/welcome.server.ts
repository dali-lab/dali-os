import { prisma } from "~/lib/db";

// The onboarding task points here; also used as the dedupe/clear key.
export const ONBOARDING_LINK = "/onboarding";

// Welcome a newly-promoted member by dropping a persistent "finish onboarding"
// todo notification (links to /onboarding). Best-effort — a failure here must
// never block the acceptance/release that triggered it, so callers wrap this in
// try/catch.
//
// The onboarding *email* is no longer sent separately: its content is folded
// into the Accepted decision email at the release call site via
// `onboardingEmailHtml` below, so an accepted applicant receives a single email.
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
  // For the email greeting + the address to send to. Kept for call-site parity;
  // the email itself is now part of the Accepted decision email.
  firstName: string;
  email: string | null;
  // The member's newly-provisioned @dali.dartmouth.edu login email, if any.
  daliEmail?: string | null;
}): Promise<{ notified: boolean }> {
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

  return { notified };
}

// Onboarding block appended to the Accepted decision email so a new member gets
// a single email: the lead-authored acceptance copy, followed by their account
// details + the link into DALI OS. Includes the DALI logo.
//
// daliEmail is the newly-provisioned @dali.dartmouth.edu login address. It may
// be null when Workspace provisioning hasn't completed yet (e.g. a transient
// failure) — in that case we say the account is still being set up rather than
// showing a blank "ready" line, so the member isn't told to log in with an
// address that doesn't exist.
//
// tempPassword is the one-time initial password for a freshly-created account
// (the account forces a password change at first login). When present it's shown
// alongside the email so the member can actually sign in. It is null when the
// account already existed (re-release) — then we just tell them to use their
// existing password. SECURITY: this is a live credential; it must only ever be
// rendered into this email, never logged.
export function onboardingEmailHtml(
  daliEmail: string | null,
  tempPassword: string | null = null,
): string {
  const base = (process.env.FRONTEND_URL ?? "").replace(/\/$/, "");
  const loginUrl = `${base}/login`;
  const logoUrl = `${base}/logo-blue.png`;

  let accountBlock: string;
  if (daliEmail && tempPassword) {
    accountBlock = `
      <p>Your DALI account is ready. Log in to DALI OS with:</p>
      <p style="margin:8px 0;padding:12px 16px;background:#f3f4f6;border-radius:6px;font-family:monospace;">
        Email: <strong>${daliEmail}</strong><br/>
        Temporary password: <strong>${tempPassword}</strong>
      </p>
      <p>You'll be required to change this temporary password the first time you log in. Don't share it.</p>`;
  } else if (daliEmail) {
    accountBlock = `<p>Your DALI account is ready. <strong>Log in to DALI OS with your DALI email: ${daliEmail}</strong> using your existing password.</p>`;
  } else {
    accountBlock = `<p>Your DALI account is being set up — you'll receive your DALI login email shortly. In the meantime you can finish the rest of your onboarding below.</p>`;
  }

  return `
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;"/>
    <p><img src="${logoUrl}" alt="DALI Lab" width="96" style="display:block;border:0;"/></p>
    <p>Welcome to the DALI Lab!</p>
    ${accountBlock}
    <p>Once you're in, finish setting up by completing your member profile and onboarding steps.</p>
    <p><a href="${loginUrl}">Log in to DALI OS</a></p>
    <p>— The DALI Lab</p>
  `;
}
