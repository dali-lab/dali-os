import { describe, expect, it } from "vitest";

import {
  signInLinkEmail,
  otpEmail,
  verifyEmailEmail,
  humanDuration,
  MAGIC_LINK_TTL_SECONDS,
  EMAIL_OTP_TTL_SECONDS,
  VERIFY_EMAIL_TTL_SECONDS,
  type OtpPurpose,
} from "~/email/lib/auth-email";

const URL = "https://os.dali.dartmouth.edu/api/auth/magic-link/verify?token=abc";

describe("humanDuration", () => {
  it("prefers whole days, so a 7-day invite is not 168 hours", () => {
    expect(humanDuration(7 * 86_400)).toBe("7 days");
    expect(humanDuration(86_400)).toBe("1 day");
  });

  it("then whole hours", () => {
    expect(humanDuration(3600)).toBe("1 hour");
    expect(humanDuration(7200)).toBe("2 hours");
  });

  it("then minutes", () => {
    expect(humanDuration(600)).toBe("10 minutes");
    expect(humanDuration(60)).toBe("1 minute");
    expect(humanDuration(900)).toBe("15 minutes");
  });
});

describe("expiry copy is derived, not written", () => {
  // The regression this guards: the verification email stated no expiry at all
  // while expiring in an hour, and the sign-in link said "expires shortly" for a
  // 5-minute window. Both were BetterAuth defaults nobody had declared.
  it("states the sign-in link's real TTL", () => {
    const mail = signInLinkEmail({ url: URL });
    const expected = humanDuration(MAGIC_LINK_TTL_SECONDS);
    expect(mail.bodyHtml).toContain(`expires in ${expected}`);
    expect(mail.text).toContain(`expires in ${expected}`);
    expect(mail.bodyHtml).not.toContain("expires shortly");
  });

  it("states the code's real TTL", () => {
    const mail = otpEmail({ otp: "123456", purpose: "sign-in" });
    expect(mail.bodyHtml).toContain(`expires in ${humanDuration(EMAIL_OTP_TTL_SECONDS)}`);
  });

  it("states the verification link's real TTL rather than staying silent", () => {
    const mail = verifyEmailEmail({ url: URL });
    expect(mail.bodyHtml).toContain(`expires in ${humanDuration(VERIFY_EMAIL_TTL_SECONDS)}`);
  });
});

describe("otpEmail labels each purpose", () => {
  // One BetterAuth callback serves four OTP types; all four used to render as
  // "sign-in code", so a password-reset code described itself wrongly.
  const cases: [OtpPurpose, string][] = [
    ["sign-in", "sign-in code"],
    ["email-verification", "verification code"],
    ["forget-password", "password reset code"],
    ["change-email", "email change code"],
  ];

  for (const [purpose, phrase] of cases) {
    it(`describes ${purpose} as a ${phrase}`, () => {
      const mail = otpEmail({ otp: "123456", purpose });
      expect(mail.subject.toLowerCase()).toContain(phrase);
      expect(mail.bodyHtml.toLowerCase()).toContain(phrase);
    });
  }

  it("falls back to sign-in wording for an unrecognised type", () => {
    const mail = otpEmail({ otp: "123456", purpose: "something-new" as OtpPurpose });
    expect(mail.subject).toBe("Your DALI OS sign-in code");
  });

  it("carries the code in both parts", () => {
    const mail = otpEmail({ otp: "424242", purpose: "sign-in" });
    expect(mail.bodyHtml).toContain("424242");
    expect(mail.text).toContain("424242");
  });
});

describe("auth emails carry a usable text part", () => {
  it("puts the sign-in URL in the text, since there is no button", () => {
    expect(signInLinkEmail({ url: URL }).text).toContain(URL);
  });

  it("puts the verification URL in the text", () => {
    expect(verifyEmailEmail({ url: URL }).text).toContain(URL);
  });

  it("never ships markup in the text part", () => {
    for (const mail of [
      signInLinkEmail({ url: URL }),
      verifyEmailEmail({ url: URL }),
      otpEmail({ otp: "123456", purpose: "sign-in" }),
    ]) {
      expect(mail.text).not.toMatch(/<[a-z]/i);
      expect(mail.text.trim().length).toBeGreaterThan(0);
    }
  });
});
