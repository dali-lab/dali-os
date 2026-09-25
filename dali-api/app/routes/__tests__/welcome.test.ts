import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoist mocks before imports.
const mockGetBetterAuthUser = vi.hoisted(() => vi.fn());
const mockCaptureDartmouthIdentity = vi.hoisted(() => vi.fn());
const mockIsFeatureEnabledForEveryone = vi.hoisted(() => vi.fn());
const mockUserUpdate = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db", () => ({
  prisma: {
    user: { update: mockUserUpdate },
  },
}));

vi.mock("~/lib/betterauth-compat.server", () => ({
  getBetterAuthUser: mockGetBetterAuthUser,
}));

vi.mock("~/lib/feature-flags.server", () => ({
  isFeatureEnabledForEveryone: mockIsFeatureEnabledForEveryone,
}));

vi.mock("~/lib/dartmouth-capture.server", () => ({
  captureDartmouthIdentity: mockCaptureDartmouthIdentity,
}));

import { loader, action } from "~/routes/welcome";

const DARTMOUTH_USER = {
  sub: "user-dart-1",
  email: "ada@dartmouth.edu",
  type: "dartmouth",
  firstName: undefined,
  lastName: undefined,
};

const MEMBER_USER = {
  sub: "user-member-1",
  email: "ada@dali.dartmouth.edu",
  type: "member",
  firstName: "Ada",
  lastName: "Lovelace",
};

const PARTNER_USER = {
  sub: "user-partner-1",
  email: "ada@company.com",
  type: "partner",
  firstName: undefined,
  lastName: undefined,
};

function makeRequest(url = "http://localhost/welcome?door=dartmouth") {
  return new Request(url);
}

function makePostRequest(body: Record<string, string>) {
  const form = new URLSearchParams(body);
  return new Request("http://localhost/welcome", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsFeatureEnabledForEveryone.mockResolvedValue(true);
  mockGetBetterAuthUser.mockResolvedValue(DARTMOUTH_USER);
  mockCaptureDartmouthIdentity.mockResolvedValue({ netIdCaptured: false });
  mockUserUpdate.mockResolvedValue({});
});

// ── Loader ────────────────────────────────────────────────────────────────────

describe("GET /welcome loader", () => {
  it("flag-OFF redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await loader({ request: makeRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("no session redirects to /login", async () => {
    mockGetBetterAuthUser.mockResolvedValue(null);
    const res = (await loader({ request: makeRequest() } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("missing door redirects to /", async () => {
    const res = (await loader({
      request: makeRequest("http://localhost/welcome"),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("invalid door redirects to /", async () => {
    const res = (await loader({
      request: makeRequest("http://localhost/welcome?door=hacker"),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("valid door=dartmouth returns the setup step with email + door + needsName=true", async () => {
    const result = await loader({ request: makeRequest() } as any);
    expect(result).toEqual({
      step: "setup",
      email: "ada@dartmouth.edu",
      door: "dartmouth",
      needsName: true,
    });
  });

  it("user with firstName has needsName=false", async () => {
    mockGetBetterAuthUser.mockResolvedValue(MEMBER_USER);
    const result = await loader({
      request: makeRequest("http://localhost/welcome?door=member"),
    } as any);
    expect(result).toMatchObject({ step: "setup", needsName: false });
  });

  it("step=passkey returns the passkey step with the door's destination", async () => {
    const result = await loader({
      request: makeRequest("http://localhost/welcome?door=partner&step=passkey"),
    } as any);
    expect(result).toEqual({ step: "passkey", door: "partner", destination: "/partner" });
  });
});

// ── Action — flag-OFF / no session ───────────────────────────────────────────

describe("POST /welcome action — guards", () => {
  it("flag-OFF redirects to /login", async () => {
    mockIsFeatureEnabledForEveryone.mockResolvedValue(false);
    const res = (await action({
      request: makePostRequest({ door: "dartmouth", intent: "finish" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("no session redirects to /login", async () => {
    mockGetBetterAuthUser.mockResolvedValue(null);
    const res = (await action({
      request: makePostRequest({ door: "dartmouth", intent: "finish" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });
});

// ── Action — dartmouth door ───────────────────────────────────────────────────

describe("POST /welcome action — dartmouth door", () => {
  it("provisions dartmouth identity when email is @dartmouth.edu", async () => {
    const res = (await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "skip",
      }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/welcome?door=dartmouth&step=passkey");
    expect(mockCaptureDartmouthIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ userId: DARTMOUTH_USER.sub, fullName: "Ada Lovelace" }),
    );
  });

  it("rejects when session email is not @dartmouth.edu", async () => {
    mockGetBetterAuthUser.mockResolvedValue({ ...DARTMOUTH_USER, email: "ada@gmail.com" });
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "skip",
      }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("@dartmouth.edu") });
    expect(mockCaptureDartmouthIdentity).not.toHaveBeenCalled();
  });

  it("requires a name when needsName (no firstName on user)", async () => {
    const result = await action({
      request: makePostRequest({ door: "dartmouth", intent: "skip" }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("full name") });
  });
});

// ── Action — door routing ─────────────────────────────────────────────────────

describe("POST /welcome action — door destinations", () => {
  it("member door setup advances to the passkey step (carrying the door)", async () => {
    mockGetBetterAuthUser.mockResolvedValue(MEMBER_USER);
    const res = (await action({
      request: makePostRequest({ door: "member", intent: "skip" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/welcome?door=member&step=passkey");
  });

  it("partner door setup advances to the passkey step (carrying the door)", async () => {
    mockGetBetterAuthUser.mockResolvedValue(PARTNER_USER);
    const res = (await action({
      request: makePostRequest({ door: "partner", intent: "skip", fullName: "Ada Lovelace" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/welcome?door=partner&step=passkey");
  });
});
