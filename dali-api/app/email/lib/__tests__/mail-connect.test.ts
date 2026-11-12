import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { mailAccount: { upsert: vi.fn() }, mailAccountConnection: { upsert: vi.fn() } },
}));
vi.mock("~/lib/roles", () => ({}));
vi.mock("~/lib/groups", () => ({}));
vi.mock("~/lib/feature-flags.server", () => ({}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getApiBaseUrl: () => "https://dali.example" }));
vi.mock("~/calendar/lib/google-calendar.server", () => ({ buildEncryptedTokens: vi.fn(() => "encrypted-blob") }));
vi.mock("~/lib/google-oauth", () => {
  class GoogleOAuthError extends Error {}
  return { GoogleOAuthError, exchangeGoogleCode: vi.fn(), resolveGoogleEmail: vi.fn() };
});
vi.mock("~/email/lib/access.server", async () => ({
  ...(await vi.importActual<object>("~/email/lib/access.server")),
  expectedConnectAddress: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { buildEncryptedTokens } from "~/calendar/lib/google-calendar.server";
import { exchangeGoogleCode, GoogleOAuthError, resolveGoogleEmail } from "~/lib/google-oauth";
import { expectedConnectAddress } from "~/email/lib/access.server";
import {
  MAIL_STATE_COOKIE,
  completeMailConnect,
  isMailConnectCallback,
  mailConnectRedirectUri,
} from "~/email/lib/mail-connect.server";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

const callback = (state: string, cookie?: string) =>
  new Request(`http://localhost/integrations/calendar/google/callback?state=${state}&code=c`, {
    headers: cookie ? { Cookie: cookie } : {},
  });

describe("isMailConnectCallback", () => {
  it("claims the shared callback only when the state matches the mail connect's cookie", () => {
    expect(isMailConnectCallback(callback("abc", `${MAIL_STATE_COOKIE}=abc.cGVyc29uYWw`))).toBe(true);
  });

  it("leaves calendar links alone", () => {
    expect(isMailConnectCallback(callback("abc"))).toBe(false);
    expect(isMailConnectCallback(callback("abc", `${MAIL_STATE_COOKIE}=other.cGVyc29uYWw`))).toBe(false);
    expect(isMailConnectCallback(callback("abc", "__dali_cal_oauth_state=abc"))).toBe(false);
  });

  it("finds the cookie among others", () => {
    expect(isMailConnectCallback(callback("abc", `x=1; ${MAIL_STATE_COOKIE}=abc.cGVyc29uYWw; y=2`))).toBe(true);
  });

  it("needs a state param", () => {
    const req = new Request("http://localhost/cb", { headers: { Cookie: `${MAIL_STATE_COOKIE}=.cGVyc29uYWw` } });
    expect(isMailConnectCallback(req)).toBe(false);
  });
});

it("redirects Google back through the calendar callback registered on the OAuth client", () => {
  expect(mailConnectRedirectUri()).toBe("https://dali.example/integrations/calendar/google/callback");
});

describe("completeMailConnect", () => {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const req = (o: { state?: string; cookie?: string | null; qs?: string } = {}) => {
    const state = o.state ?? "s1";
    const cookie = o.cookie === undefined ? `${MAIL_STATE_COOKIE}=s1.${b64("personal")}` : o.cookie;
    return new Request(`http://localhost/cb?${o.qs ?? `code=c&state=${state}`}`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
  };
  const location = (res: Response) => res.headers.get("Location");

  beforeEach(() => {
    vi.resetAllMocks();
    m(buildEncryptedTokens).mockReturnValue("encrypted-blob");
    m(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } });
    m(expectedConnectAddress).mockResolvedValue("Ada@Example.edu");
    m(exchangeGoogleCode).mockResolvedValue({
      access_token: "access-fake",
      refresh_token: "refresh-fake",
      expires_in: 3600,
      scope: "openid https://www.googleapis.com/auth/gmail.modify",
      id_token: "idt",
    });
    m(resolveGoogleEmail).mockResolvedValue("ADA@example.edu");
    db.mailAccount.upsert.mockResolvedValue({ id: "acct1" });
  });

  const expectNothingStored = () => {
    expect(db.mailAccount.upsert).not.toHaveBeenCalled();
    expect(db.mailAccountConnection.upsert).not.toHaveBeenCalled();
  };

  it("sends signed-out users to login without touching Google", async () => {
    m(requireAuth).mockResolvedValue({ ok: false });
    const res = await completeMailConnect(req());
    expect(location(res)).toBe("/login");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it.each([
    ["a Google error", { qs: "error=access_denied&code=c&state=s1" }],
    ["a missing code", { qs: "state=s1" }],
    ["a missing state", { qs: "code=c" }],
  ])("fails on %s", async (_n, o) => {
    const res = await completeMailConnect(req(o));
    expect(location(res)).toBe("/email?mail_error=auth_failed");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("clears the state cookie on every redirect", async () => {
    const res = await completeMailConnect(req({ qs: "error=x" }));
    expect(res.headers.get("Set-Cookie")).toContain(`${MAIL_STATE_COOKIE}=; Path=/; Max-Age=0`);
  });

  it.each([
    ["no cookie", { cookie: null }],
    ["a different state", { cookie: `${MAIL_STATE_COOKIE}=other.${Buffer.from("personal").toString("base64url")}` }],
    ["a cookie with no target", { cookie: `${MAIL_STATE_COOKIE}=s1` }],
    ["an unparseable target", { cookie: `${MAIL_STATE_COOKIE}=s1.${Buffer.from("bogus").toString("base64url")}` }],
  ])("rejects %s as a state mismatch", async (_n, o) => {
    const res = await completeMailConnect(req(o));
    expect(location(res)).toBe("/email?mail_error=state_mismatch");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("refuses a target the user may not connect, before spending the code", async () => {
    m(expectedConnectAddress).mockResolvedValue(undefined);
    const res = await completeMailConnect(req());
    expect(location(res)).toBe("/email?mail_error=forbidden");
    expect(expectedConnectAddress).toHaveBeenCalledWith("u1", { kind: "Personal" }, expect.any(Request));
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });

  it("maps a failed code exchange, and rethrows other errors", async () => {
    m(exchangeGoogleCode).mockRejectedValueOnce(new GoogleOAuthError("bad"));
    expect(location(await completeMailConnect(req()))).toBe("/email?mail_error=token_exchange_failed");
    m(exchangeGoogleCode).mockRejectedValueOnce(new TypeError("bug"));
    await expect(completeMailConnect(req())).rejects.toThrow("bug");
  });

  it("requires the Gmail modify scope when Google reports scopes", async () => {
    m(exchangeGoogleCode).mockResolvedValue({
      access_token: "a",
      refresh_token: "r",
      scope: "openid email",
    });
    expect(location(await completeMailConnect(req()))).toBe("/email?mail_error=scope_denied");
    expectNothingStored();
  });

  it("requires a refresh token", async () => {
    m(exchangeGoogleCode).mockResolvedValue({ access_token: "a", scope: "https://www.googleapis.com/auth/gmail.modify" });
    expect(location(await completeMailConnect(req()))).toBe("/email?mail_error=no_refresh_token");
    expectNothingStored();
  });

  it("fails when Google gives no email", async () => {
    m(resolveGoogleEmail).mockResolvedValue(null);
    expect(location(await completeMailConnect(req()))).toBe("/email?mail_error=no_email");
    expectNothingStored();
  });

  it("rejects signing in as the wrong Google account, storing nothing", async () => {
    m(resolveGoogleEmail).mockResolvedValue("grace@example.edu");
    expect(location(await completeMailConnect(req()))).toBe("/email?mail_error=wrong_account");
    expectNothingStored();
  });

  it("personal connect: matches the expected address case-insensitively and stores encrypted tokens against the user's own account", async () => {
    const res = await completeMailConnect(req());
    expect(location(res)).toBe("/email?mail_connected=1");
    expect(buildEncryptedTokens).toHaveBeenCalledWith({
      accessToken: "access-fake",
      refreshToken: "refresh-fake",
      expiresInSec: 3600,
    });
    expect(db.mailAccount.upsert).toHaveBeenCalledWith({
      where: { scopeKey_address: { scopeKey: "user:u1", address: "ada@example.edu" } },
      create: { kind: "Personal", scopeKey: "user:u1", userId: "u1", address: "ada@example.edu" },
      update: {},
      select: { id: true },
    });
    expect(db.mailAccountConnection.upsert).toHaveBeenCalledWith({
      where: { accountId_userId: { accountId: "acct1", userId: "u1" } },
      create: { accountId: "acct1", userId: "u1", oauthTokens: "encrypted-blob" },
      update: { oauthTokens: "encrypted-blob", syncError: null, connectedAt: expect.any(Date) },
    });
  });

  it("project connect: creates the project's inbox under its own scope", async () => {
    await completeMailConnect(req({ cookie: `${MAIL_STATE_COOKIE}=s1.${b64("project:p7")}` }));
    expect(expectedConnectAddress).toHaveBeenCalledWith("u1", { kind: "Project", projectId: "p7" }, expect.any(Request));
    expect(db.mailAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey_address: { scopeKey: "project:p7", address: "ada@example.edu" } },
        create: { kind: "Project", scopeKey: "project:p7", projectId: "p7", address: "ada@example.edu" },
      }),
    );
  });

  it("shared connect: attaches the user's sign-in to the existing account without creating one", async () => {
    await completeMailConnect(req({ cookie: `${MAIL_STATE_COOKIE}=s1.${b64("shared:acctS")}` }));
    expect(db.mailAccount.upsert).not.toHaveBeenCalled();
    expect(db.mailAccountConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId_userId: { accountId: "acctS", userId: "u1" } },
        create: { accountId: "acctS", userId: "u1", oauthTokens: "encrypted-blob" },
      }),
    );
  });
});
