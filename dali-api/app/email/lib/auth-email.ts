// The sign-in and verification emails. Pure, so the copy can be tested without
// standing up the BetterAuth instance.
//
// These are the three emails most likely to be the first thing a new member or
// partner ever receives from us, and they carry a credential, so two rules:
//
//  1. The footer is "transactional" — no notification-settings link. A sign-in
//     code is not something anyone can switch off.
//  2. Every expiry sentence is derived from the TTL constant that actually
//     governs the credential, never hand-written. The two that used to hand-write
//     it had drifted: the verification mail claimed nothing at all while expiring
//     in an hour, and the magic link said "expires shortly" for a 5-minute window.
//
// Each builder returns the body and the parts around it rather than finished
// HTML, so the shared layout supplies the frame (see layout.server.ts)
// and the copy stays testable on its own.

import { escapeAttr } from "~/email/lib/layout";

// Declared here and passed to BetterAuth in betterauth.server.ts, so the real
// TTL and the sentence describing it come from one place. Previously these were
// BetterAuth's unset defaults, which is why the copy could drift.
export const MAGIC_LINK_TTL_SECONDS = 60 * 10;
export const EMAIL_OTP_TTL_SECONDS = 60 * 10;
export const VERIFY_EMAIL_TTL_SECONDS = 60 * 60;

// Largest whole unit wins, so a 7-day invite reads "7 days" rather than
// "168 hours" and a 10-minute code reads "10 minutes".
export function humanDuration(seconds: number): string {
  const DAY = 86_400;
  const HOUR = 3_600;
  if (seconds % DAY === 0) {
    const d = seconds / DAY;
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (seconds % HOUR === 0) {
    const h = seconds / HOUR;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const m = Math.round(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

export type AuthEmailParts = {
  subject: string;
  bodyHtml: string;
  text: string;
  preheader: string;
  cta?: { href: string; label: string };
};

const IGNORE = "If you didn't request this, you can ignore this email.";

export function signInLinkEmail(args: { url: string }): AuthEmailParts {
  const expiry = humanDuration(MAGIC_LINK_TTL_SECONDS);
  return {
    subject: "Your DALI OS sign-in link",
    preheader: `Sign in to DALI OS. Expires in ${expiry}.`,
    cta: { href: args.url, label: "Sign in to DALI OS" },
    bodyHtml: [
      `<p style="margin:0 0 16px;">Use the button below to sign in to DALI OS.</p>`,
      `<p style="margin:0;color:#52525b;font-size:14px;">The link works once and expires in ${expiry}. ${IGNORE}</p>`,
    ].join("\n"),
    text: [
      "Use the link below to sign in to DALI OS.",
      args.url,
      `The link works once and expires in ${expiry}. ${IGNORE}`,
    ].join("\n\n"),
  };
}

// One callback serves four BetterAuth OTP types. Labelling them all "sign-in
// code" meant a password-reset or email-change code arrived describing itself as
// something it wasn't.
export type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const OTP_COPY: Record<OtpPurpose, { subject: string; lead: string; where: string }> = {
  "sign-in": {
    subject: "Your DALI OS sign-in code",
    lead: "Your DALI OS sign-in code is:",
    where: "Enter it on the sign-in page.",
  },
  "email-verification": {
    subject: "Your DALI OS verification code",
    lead: "Your DALI OS verification code is:",
    where: "Enter it to confirm this email address.",
  },
  "forget-password": {
    subject: "Your DALI OS password reset code",
    lead: "Your DALI OS password reset code is:",
    where: "Enter it to choose a new password.",
  },
  "change-email": {
    subject: "Your DALI OS email change code",
    lead: "Your DALI OS email change code is:",
    where: "Enter it to confirm your new email address.",
  },
};

export function otpEmail(args: { otp: string; purpose: OtpPurpose }): AuthEmailParts {
  const copy = OTP_COPY[args.purpose] ?? OTP_COPY["sign-in"];
  const expiry = humanDuration(EMAIL_OTP_TTL_SECONDS);
  return {
    subject: copy.subject,
    preheader: `${copy.lead} ${args.otp}`,
    bodyHtml: [
      `<p style="margin:0 0 8px;">${copy.lead}</p>`,
      `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;">${escapeAttr(args.otp)}</p>`,
      `<p style="margin:0;color:#52525b;font-size:14px;">${copy.where} It expires in ${expiry}. ${IGNORE}</p>`,
    ].join("\n"),
    text: [copy.lead, args.otp, `${copy.where} It expires in ${expiry}. ${IGNORE}`].join("\n\n"),
  };
}

export function verifyEmailEmail(args: { url: string }): AuthEmailParts {
  const expiry = humanDuration(VERIFY_EMAIL_TTL_SECONDS);
  const ignore = "If you didn't create a DALI OS account, you can ignore this email.";
  return {
    subject: "Verify your email for DALI OS",
    preheader: `Confirm your email address. Expires in ${expiry}.`,
    cta: { href: args.url, label: "Verify email address" },
    bodyHtml: [
      `<p style="margin:0 0 16px;">Confirm your email address to finish setting up your DALI OS account.</p>`,
      `<p style="margin:0;color:#52525b;font-size:14px;">This link expires in ${expiry}. ${ignore}</p>`,
    ].join("\n"),
    text: [
      "Confirm your email address to finish setting up your DALI OS account.",
      args.url,
      `This link expires in ${expiry}. ${ignore}`,
    ].join("\n\n"),
  };
}
