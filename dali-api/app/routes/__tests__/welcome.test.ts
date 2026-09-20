import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoist mocks before imports.
const mockGetBetterAuthUser = vi.hoisted(() => vi.fn());
const mockSetPassword = vi.hoisted(() => vi.fn());
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

vi.mock("~/lib/betterauth.server", () => ({
  auth: {
    api: {
      setPassword: mockSetPassword,
    },
  },
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
  mockSetPassword.mockResolvedValue(undefined);
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

  it("valid door=dartmouth returns email + door + needsName=true (no firstName)", async () => {
    const result = await loader({ request: makeRequest() } as any);
    expect(result).toEqual({ email: "ada@dartmouth.edu", door: "dartmouth", needsName: true });
  });

  it("user with firstName has needsName=false", async () => {
    mockGetBetterAuthUser.mockResolvedValue(MEMBER_USER);
    const result = await loader({
      request: makeRequest("http://localhost/welcome?door=member"),
    } as any);
    expect(result).toMatchObject({ needsName: false });
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
    expect(res.headers.get("Location")).toBe("/portal");
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

// ── Action — skip path ────────────────────────────────────────────────────────

describe("POST /welcome action — skip path", () => {
  it("does not call setPassword when intent=skip (even if password is provided)", async () => {
    await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "skip",
        password: "somesecret",
        confirmPassword: "somesecret",
      }),
    } as any);
    expect(mockSetPassword).not.toHaveBeenCalled();
  });
});

// ── Action — finish path with password ───────────────────────────────────────

describe("POST /welcome action — finish path with password", () => {
  it("calls setPassword when password is provided with intent=finish", async () => {
    await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "finish",
        password: "secretpass",
        confirmPassword: "secretpass",
      }),
    } as any);
    expect(mockSetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { newPassword: "secretpass" } }),
    );
  });

  it("rejects passwords that are too short", async () => {
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "finish",
        password: "short",
        confirmPassword: "short",
      }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("8 characters") });
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched passwords", async () => {
    const result = await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "finish",
        password: "secretpass",
        confirmPassword: "different",
      }),
    } as any);
    expect(result).toMatchObject({ error: expect.stringContaining("do not match") });
    expect(mockSetPassword).not.toHaveBeenCalled();
  });

  it("finish without password does not call setPassword", async () => {
    await action({
      request: makePostRequest({
        door: "dartmouth",
        fullName: "Ada Lovelace",
        intent: "finish",
      }),
    } as any);
    expect(mockSetPassword).not.toHaveBeenCalled();
  });
});

// ── Action — door routing ─────────────────────────────────────────────────────

describe("POST /welcome action — door destinations", () => {
  it("member door redirects to /", async () => {
    mockGetBetterAuthUser.mockResolvedValue(MEMBER_USER);
    const res = (await action({
      request: makePostRequest({ door: "member", intent: "skip" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("partner door redirects to /partner", async () => {
    mockGetBetterAuthUser.mockResolvedValue(PARTNER_USER);
    const res = (await action({
      request: makePostRequest({ door: "partner", intent: "skip", fullName: "Ada Lovelace" }),
    } as any)) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/partner");
  });
});
