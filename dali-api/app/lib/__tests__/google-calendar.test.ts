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

// Queue several fetch responses in order (e.g. calendarList then events.list).
function mockFetchSequence(bodies: unknown[]) {
  const fn = vi.fn();
  for (const body of bodies) {
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }
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
  it("returns titled events from each link's primary calendar, tinted by colour", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([
      { id: "L1", subCalendarIds: [] },
    ]);
    // getValidAccessTokenForLink is called once for the link.
    prismaMock.userCalendarLink.findUnique.mockResolvedValue({
      oauthTokens: encryptedTokens({
        accessToken: "tok",
        refreshToken: "r",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      }),
    });
    // Two fetches: calendarList (for colours) then events.list for "primary".
    mockFetchSequence([
      { items: [{ id: "primary", summary: "Me", primary: true, backgroundColor: "#2952A3" }] },
      {
        items: [
          {
            id: "e1",
            summary: "Standup",
            status: "confirmed",
            start: { dateTime: "2026-05-12T13:00:00Z" },
            end: { dateTime: "2026-05-12T14:00:00Z" },
          },
          // Declined → skipped.
          {
            id: "e2",
            summary: "Declined thing",
            status: "confirmed",
            start: { dateTime: "2026-05-12T15:00:00Z" },
            end: { dateTime: "2026-05-12T16:00:00Z" },
            attendees: [{ self: true, responseStatus: "declined" }],
          },
          // All-day (date only) → skipped.
          {
            id: "e3",
            summary: "Holiday",
            status: "confirmed",
            start: { date: "2026-05-12" },
            end: { date: "2026-05-13" },
          },
        ],
      },
    ]);
    prismaMock.userCalendarLink.update.mockResolvedValue({});

    const out = await fetchBusyEvents(
      "userX",
      new Date("2026-05-12T00:00:00Z"),
      new Date("2026-05-13T00:00:00Z"),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      start: "2026-05-12T13:00:00Z",
      end: "2026-05-12T14:00:00Z",
      title: "Standup",
      calendarId: "primary",
      color: "#2952A3",
    });
  });

  it("returns [] when no UserCalendarLink exists (Phase 2: no legacy User.google* fallback)", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([]);
    const out = await fetchBusyEvents(
      "userX",
      new Date("2026-05-12T00:00:00Z"),
      new Date("2026-05-13T00:00:00Z"),
    );
    expect(out).toEqual([]);
  });

  it("returns [] when user has no link", async () => {
    prismaMock.userCalendarLink.findMany.mockResolvedValueOnce([]);
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
