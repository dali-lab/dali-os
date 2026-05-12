import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

beforeAll(() => {
  process.env.CALENDAR_TOKEN_KEY = randomBytes(32).toString("base64");
  process.env.GOOGLE_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
});

// Use vi.hoisted to satisfy vi.mock factory ordering rules.
const prismaMock = vi.hoisted(() => ({
  userCalendarLink: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  user: { findUnique: vi.fn() },
}));

vi.mock("~/lib/db", () => ({ prisma: prismaMock }));

// Import after mocking so the lib picks up the mocked prisma.
const { encrypt } = await import("~/lib/calendar-crypto");
const { getValidAccessTokenForLink, fetchBusyEvents, buildEncryptedTokens } = await import(
  "~/lib/google-calendar"
);

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function encryptedTokens(opts: { accessToken: string; refreshToken: string; expiresAt: string | null }) {
  return encrypt(JSON.stringify(opts));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("getValidAccessTokenForLink", () => {
  it("returns the stored token when not yet near expiry", async () => {
    prismaMock.userCalendarLink.findUnique.mockResolvedValueOnce({
      oauthTokens: encryptedTokens({
        accessToken: "still-good",
        refreshToken: "r1",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
    const token = await getValidAccessTokenForLink("link1");
    expect(token).toBe("still-good");
  });

  it("refreshes when token is expired and persists the new one", async () => {
    prismaMock.userCalendarLink.findUnique.mockResolvedValueOnce({
      oauthTokens: encryptedTokens({
        accessToken: "old",
        refreshToken: "r1",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    mockFetchOnce({ access_token: "fresh-access", expires_in: 3600 });
    prismaMock.userCalendarLink.update.mockResolvedValueOnce({});
    const token = await getValidAccessTokenForLink("link1");
    expect(token).toBe("fresh-access");
    expect(prismaMock.userCalendarLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link1" },
        data: expect.objectContaining({ oauthTokens: expect.any(String) }),
      }),
    );
  });

  it("throws when the link is missing", async () => {
    prismaMock.userCalendarLink.findUnique.mockResolvedValueOnce(null);
    await expect(getValidAccessTokenForLink("nope")).rejects.toThrow(/not found/);
  });
});

describe("fetchBusyEvents", () => {
  it("returns merged busy ranges from each link's primary calendar", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([
      { id: "L1", subCalendarIds: [] },
    ]);
    prismaMock.userCalendarLink.findUnique.mockResolvedValueOnce({
      oauthTokens: encryptedTokens({
        accessToken: "tok",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
    mockFetchOnce({
      calendars: {
        primary: {
          busy: [
            { start: "2026-05-12T13:00:00Z", end: "2026-05-12T14:00:00Z" },
            { start: "2026-05-12T15:00:00Z", end: "2026-05-12T16:00:00Z" },
          ],
        },
      },
    });
    prismaMock.userCalendarLink.update.mockResolvedValueOnce({});

    const out = await fetchBusyEvents(
      "userX",
      new Date("2026-05-12T00:00:00Z"),
      new Date("2026-05-13T00:00:00Z"),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ start: "2026-05-12T13:00:00Z", end: "2026-05-12T14:00:00Z" });
  });

  it("falls back to legacy User.google* tokens when no link exists", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      googleAccessToken: "legacy-tok",
      googleRefreshToken: "legacy-rt",
      googleTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
    });
    mockFetchOnce({
      calendars: { primary: { busy: [{ start: "2026-05-12T19:00:00Z", end: "2026-05-12T20:00:00Z" }] } },
    });
    const out = await fetchBusyEvents(
      "userX",
      new Date("2026-05-12T00:00:00Z"),
      new Date("2026-05-13T00:00:00Z"),
    );
    expect(out).toEqual([{ start: "2026-05-12T19:00:00Z", end: "2026-05-12T20:00:00Z" }]);
  });

  it("returns [] when user has no link and no legacy tokens", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([]);
    prismaMock.user.findUnique.mockResolvedValueOnce({
      googleAccessToken: null,
      googleRefreshToken: null,
      googleTokenExpiresAt: null,
    });
    const out = await fetchBusyEvents(
      "userX",
      new Date("2026-05-12T00:00:00Z"),
      new Date("2026-05-13T00:00:00Z"),
    );
    expect(out).toEqual([]);
  });
});

describe("buildEncryptedTokens", () => {
  it("produces a decryptable, expected payload", async () => {
    const cipher = buildEncryptedTokens({
      accessToken: "a",
      refreshToken: "b",
      expiresInSec: 3600,
    });
    const { decrypt } = await import("~/lib/calendar-crypto");
    const parsed = JSON.parse(decrypt(cipher));
    expect(parsed.accessToken).toBe("a");
    expect(parsed.refreshToken).toBe("b");
    expect(typeof parsed.expiresAt).toBe("string");
  });

  it("stores null expiresAt when no expiresInSec is provided", async () => {
    const cipher = buildEncryptedTokens({
      accessToken: "a",
      refreshToken: "b",
      expiresInSec: null,
    });
    const { decrypt } = await import("~/lib/calendar-crypto");
    const parsed = JSON.parse(decrypt(cipher));
    expect(parsed.expiresAt).toBeNull();
  });
});
