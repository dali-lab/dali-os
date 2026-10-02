import { describe, expect, it } from "vitest";

import { freshKey } from "~/lib/outbound-keys";

describe("freshKey", () => {
  it("is unique per call so the (channel, dedupKey) claim never coalesces a resend", () => {
    const a = freshKey("auth.email_otp", "x@dartmouth.edu");
    const b = freshKey("auth.email_otp", "x@dartmouth.edu");
    expect(a).not.toBe(b);
  });

  it("keeps the prefix and scope legible for Admin → Communications", () => {
    const key = freshKey("auth.magic_link", "x@dartmouth.edu");
    expect(key.startsWith("auth.magic_link:x@dartmouth.edu:")).toBe(true);
  });

  it("derives uniqueness from a nonce, not from anything the caller passes", () => {
    // The regression this guards: dedupKey used to be
    // `auth.email_otp:${email}:${otp}`. The retention janitor strips bodyHtml at
    // 24h but never dedupKey, and Sent rows live until retentionMonths, so the
    // live code sat in Postgres for ~6 months. Nothing beyond prefix and scope
    // may appear in the key, so there is nowhere for a credential to hide.
    const key = freshKey("p", "s");
    const nonce = key.slice("p:s:".length);
    expect(nonce).toMatch(/^[0-9a-f-]{36}$/);
    expect(key).toBe(`p:s:${nonce}`);
  });
});
