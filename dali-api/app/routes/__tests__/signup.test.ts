import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoist mocks before imports.
const mockSignInSocial = vi.hoisted(() => vi.fn());
const mockSignInMagicLink = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());
const mockClassifyPartnerEmail = vi.hoisted(() => vi.fn());
const mockSendMemberEmailConflictEmail = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db");

vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    api: {
      signInSocial: mockSignInSocial,
      signInMagicLink: mockSignInMagicLink,
    },
  },
}));

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));

vi.mock("~/partners/lib/magic-link.server", () => ({
  classifyPartnerEmail: mockClassifyPartnerEmail,
  normalizeEmail: (e: string) => e.trim().toLowerCase(),
}));

vi.mock("~/partners/lib/partner-emails.server", () => ({
  sendMemberEmailConflictEmail: mockSendMemberEmailConflictEmail,
}));

import { loader, action } from "~/routes/signup";
import { prisma } from "~/lib/db";

const mockUserFindFirst = vi.mocked(prisma.user.findFirst);

function makeUrl(path = "/signup") {
  return new Request(`http://localhost${path}`);
}

function makePostRequest(body: Record<string, string>) {
  const form = new URLSearchParams(body);
  return new Request("http://localhost/signup", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: flag is ON.
  mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
  mockSignInSocial.mockResolvedValue({ url: "https://accounts.google.com/oauth" });
  mockSignInMagicLink.mockResolvedValue(undefined);
  mockSendMemberEmailConflictEmail.mockResolvedValue(undefined);
  mockClassifyPartnerEmail.mockResolvedValue({ kind: "new" });
  // Default: no existing account, so signups proceed to the signup magic link.
  mockUserFindFirst.mockResolvedValue(null as any);
});

// ── Loader ────────────────────────────────────────────────────────────────────

describe("GET /signup loader", () => {
  it("flag-OFF redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await loader({ request: makeUrl() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("flag-ON with no door returns null door", async () => {
    const result = await loader({ request: makeUrl("/signup") } as any);
    expect(result).toEqual({ door: null });
  });

  it("flag-ON with valid door=dartmouth returns it", async () => {
    const result = await loader({ request: makeUrl("/signup?door=dartmouth") } as any);
    expect(result).toEqual({ door: "dartmouth" });
  });

  it("flag-ON with invalid door returns null", async () => {
    const result = await loader({ request: makeUrl("/signup?door=hacker") } as any);
    expect(result).toEqual({ door: null });
  });
});

// ── Action — flag-OFF ─────────────────────────────────────────────────────────

describe("POST /signup action flag-OFF", () => {
  it("redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await action({
      request: makePostRequest({ door: "member", provider: "google" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});

// ── Action — email magic link ─────────────────────────────────────────────────

describe("POST /signup action email-link — member door", () => {
  it("sends a magic link for an @dali.dartmouth.edu email and returns sent=true", async () => {
    const result = await action({
      request: makePostRequest({
        door: "member",
        provider: "email-link",
        email: "ada@dali.dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({ sent: true, email: "ada@dali.dartmouth.edu" });
    expect(mockSignInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ callbackURL: "/welcome?door=member" }),
      }),
    );
  });

  it("rejects a non-@dali.dartmouth.edu email", async () => {
    const result = await action({
      request: makePostRequest({
        door: "member",
        provider: "email-link",
        email: "ada@gmail.com",
      }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("@dali.dartmouth.edu") });
    expect(mockSignInMagicLink).not.toHaveBeenCalled();
  });
});

describe("POST /signup action email-link — dartmouth door", () => {
  it("rejects non-@dartmouth.edu email", async () => {
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        provider: "email-link",
        email: "ada@gmail.com",
      }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("@dartmouth.edu") });
    expect(mockSignInMagicLink).not.toHaveBeenCalled();
  });

  it("accepts @dartmouth.edu email and returns sent=true", async () => {
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        provider: "email-link",
        email: "ada@dartmouth.edu",
      }),
    } as any);
    expect(result).toMatchObject({ sent: true, email: "ada@dartmouth.edu" });
    expect(mockSignInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ callbackURL: "/welcome?door=dartmouth" }),
      }),
    );
  });
});

describe("POST /signup duplicate guard (member/dartmouth)", () => {
  it("signs an existing account into its canonical email instead of a new signup", async () => {
    // A member's @dartmouth alias already belongs to their @dali account.
    mockUserFindFirst.mockResolvedValue({ email: "ada@dali.dartmouth.edu" } as any);
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        provider: "email-link",
        email: "ada@dartmouth.edu",
      }),
    } as any);
    // Neutral response still shows what they typed.
    expect(result).toMatchObject({ sent: true, email: "ada@dartmouth.edu" });
    // The link goes to the canonical email (sign-in), not a new /welcome signup.
    expect(mockSignInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ email: "ada@dali.dartmouth.edu", callbackURL: "/" }),
      }),
    );
  });
});

describe("POST /signup action email-link — partner door", () => {
  it("member-conflict email triggers conflict email and returns neutral sent=true", async () => {
    mockClassifyPartnerEmail.mockResolvedValue({ kind: "member-conflict" });
    const result = await action({
      request: makePostRequest({
        door: "partner",
        provider: "email-link",
        email: "ada@dali.dartmouth.edu",
      }),
    } as any);
    expect(mockSendMemberEmailConflictEmail).toHaveBeenCalled();
    expect(result).toMatchObject({ sent: true });
  });

  it("new email sends magic link with /welcome?door=partner callbackURL", async () => {
    mockClassifyPartnerEmail.mockResolvedValue({ kind: "new" });
    const result = await action({
      request: makePostRequest({
        door: "partner",
        provider: "email-link",
        email: "ada@company.com",
      }),
    } as any);
    expect(result).toMatchObject({ sent: true, email: "ada@company.com" });
    expect(mockSignInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ callbackURL: "/welcome?door=partner" }),
      }),
    );
  });

  it("swallows signInMagicLink errors and still returns sent=true (anti-enumeration)", async () => {
    mockClassifyPartnerEmail.mockResolvedValue({ kind: "new" });
    mockSignInMagicLink.mockRejectedValue(new Error("BetterAuth error"));
    const result = await action({
      request: makePostRequest({
        door: "partner",
        provider: "email-link",
        email: "ada@company.com",
      }),
    } as any);
    expect(result).toMatchObject({ sent: true });
  });
});
