import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/db", () => ({
  prisma: { userCalendarLink: { upsert: vi.fn().mockResolvedValue({}) } },
}));
vi.mock("~/lib/google-calendar", () => ({
  buildEncryptedTokens: vi.fn(() => "v1:iv:tag:ct"),
}));
vi.mock("~/email/lib/mail-connect.server", () => ({
  isMailConnectCallback: vi.fn(() => false),
  completeMailConnect: vi.fn(),
}));
// buildGoogleAuthUrl and GoogleOAuthError stay real: the start-route assertions
// below read the authorization URL this module actually builds.
vi.mock("~/lib/google-oauth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/google-oauth")>()),
  exchangeGoogleCode: vi.fn(),
  resolveGoogleEmail: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { exchangeGoogleCode, resolveGoogleEmail } from "~/lib/google-oauth";
import { prisma } from "~/lib/db";
import {
  loader as startLoader,
  CAL_STATE_COOKIE,
  GOOGLE_CALENDAR_SCOPES,
} from "~/routes/oauth.calendar.google.start";
import { loader as callbackLoader } from "~/routes/integrations.calendar.google.callback";

const UMBRELLA_SCOPE = "https://www.googleapis.com/auth/calendar";
const STATE = "state-abc";

function callbackRequest(grantedScope: string | undefined) {
  vi.mocked(exchangeGoogleCode).mockResolvedValue({
    access_token: "at",
    refresh_token: "rt",
    expires_in: 3600,
    id_token: "idt",
    scope: grantedScope,
  } as never);
  return new Request(
    `http://localhost/integrations/calendar/google/callback?code=c&state=${STATE}`,
    { headers: { Cookie: `${CAL_STATE_COOKIE}=${STATE}` } },
  );
}

function linkErrorFrom(res: Response): string | null {
  return new URL(res.headers.get("Location")!, "http://localhost").searchParams.get(
    "calendar_link_error",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_BASE_URL = "http://localhost:3001";
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  vi.mocked(requireAuth).mockResolvedValue({
    ok: true,
    user: { sub: "user-1", type: "member" },
  } as never);
  vi.mocked(resolveGoogleEmail).mockResolvedValue("member@dartmouth.edu");
});

describe("calendar link OAuth scopes", () => {
  it("requests one granular scope per API surface, never the umbrella scope", async () => {
    const res = await startLoader({
      request: new Request("http://localhost/oauth/calendar/google/start"),
    });

    const authUrl = new URL(res.headers.get("Location")!);
    const requested = authUrl.searchParams.get("scope")!.split(" ");

    expect(requested).toEqual(["openid", "email", ...GOOGLE_CALENDAR_SCOPES]);
    // The umbrella scope also grants the ACL (calendar sharing) surface, which
    // nothing in the app calls. Asking for it again would be a regression.
    expect(requested).not.toContain(UMBRELLA_SCOPE);
    expect(GOOGLE_CALENDAR_SCOPES).not.toContain(UMBRELLA_SCOPE);
  });

  it("links the calendar when Google grants every requested scope", async () => {
    const res = await callbackLoader({
      request: callbackRequest(["openid", "email", ...GOOGLE_CALENDAR_SCOPES].join(" ")),
    } as never);

    expect(linkErrorFrom(res)).toBeNull();
    expect(prisma.userCalendarLink.upsert).toHaveBeenCalledTimes(1);
  });

  it("refuses the link when granular consent drops one of the scopes", async () => {
    const partial = ["openid", "email", ...GOOGLE_CALENDAR_SCOPES.slice(0, -1)].join(" ");

    const res = await callbackLoader({ request: callbackRequest(partial) } as never);

    expect(linkErrorFrom(res)).toBe("calendar_scope_denied");
    expect(prisma.userCalendarLink.upsert).not.toHaveBeenCalled();
  });

  it("accepts the pre-reduction umbrella grant so existing members can relink", async () => {
    // Google accumulates scopes per client: a member who linked under the old
    // umbrella scope can have it echoed back instead of the granular three.
    const res = await callbackLoader({
      request: callbackRequest(["openid", "email", UMBRELLA_SCOPE].join(" ")),
    } as never);

    expect(linkErrorFrom(res)).toBeNull();
    expect(prisma.userCalendarLink.upsert).toHaveBeenCalledTimes(1);
  });

  it("still links when Google omits the scope field from the token response", async () => {
    const res = await callbackLoader({ request: callbackRequest(undefined) } as never);

    expect(linkErrorFrom(res)).toBeNull();
    expect(prisma.userCalendarLink.upsert).toHaveBeenCalledTimes(1);
  });
});
