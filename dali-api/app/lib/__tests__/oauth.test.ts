import { describe, it, expect, beforeEach, vi } from "vitest";

const mockVerifyIdToken = vi.hoisted(() => vi.fn());
const mockGetPayload = vi.hoisted(() => vi.fn());

vi.mock("~/lib/db");
vi.mock("google-auth-library", () => ({
  OAuth2Client: vi.fn().mockImplementation(function () {
    return { verifyIdToken: mockVerifyIdToken };
  }),
}));

import { prisma } from "~/lib/db";
import {
  verifyPKCE,
  OAuthError,
  isAllowedRedirectUri,
  exchangeAuthorizationCode,
  exchangeGoogleCode,
  buildUserInfo,
} from "~/lib/oauth";

const mockPrisma = prisma as unknown as {
  oAuthSession: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  oAuthClient: {
    findUnique: ReturnType<typeof vi.fn>;
  };
};

const DEFAULT_CLIENT = {
  clientId: "dali-api",
  name: "Dali",
  redirectUris: ["http://localhost:5173/login"],
  isLoopback: false,
  isFirstParty: false,
  allowedScopes: [],
  allowedProviders: ["google", "cas"],
  requiredAccountType: null,
  requireMembership: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.oAuthSession = {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  } as any;
  mockPrisma.oAuthClient = {
    findUnique: vi.fn().mockResolvedValue(DEFAULT_CLIENT),
  } as any;
});

describe("verifyPKCE", () => {
  it("returns true for valid S256 challenge", async () => {
    const { createHash } = await import("node:crypto");
    const verifier = "test-verifier-string";
    const challenge = createHash("sha256")
      .update(verifier)
      .digest("base64url");
    expect(verifyPKCE(verifier, challenge, "S256")).toBe(true);
  });

  it("returns false for invalid verifier", async () => {
    const { createHash } = await import("node:crypto");
    const challenge = createHash("sha256")
      .update("correct-verifier")
      .digest("base64url");
    expect(verifyPKCE("wrong-verifier", challenge, "S256")).toBe(false);
  });

  it("returns false for non-S256 method", () => {
    expect(verifyPKCE("any", "any", "plain")).toBe(false);
  });
});

describe("OAuthError", () => {
  it("toJSON returns error and error_description", () => {
    const err = new OAuthError("invalid_grant", "Token expired");
    expect(err.toJSON()).toEqual({
      error: "invalid_grant",
      error_description: "Token expired",
    });
  });
});

describe("isAllowedRedirectUri", () => {
  it("exact-matches non-loopback redirect URIs", () => {
    const client = { redirectUris: ["http://example.com/cb"], isLoopback: false };
    expect(isAllowedRedirectUri(client, "http://example.com/cb")).toBe(true);
    expect(isAllowedRedirectUri(client, "http://example.com/cb?x=1")).toBe(false);
  });

  it("accepts loopback addresses with any port when client is loopback", () => {
    const client = {
      redirectUris: ["http://127.0.0.1/callback"],
      isLoopback: true,
    };
    expect(isAllowedRedirectUri(client, "http://127.0.0.1:51234/callback")).toBe(true);
    expect(isAllowedRedirectUri(client, "http://localhost:9999/callback")).toBe(true);
  });

  it("rejects loopback over https, public IPs, and 0.0.0.0", () => {
    const client = {
      redirectUris: ["http://127.0.0.1/callback"],
      isLoopback: true,
    };
    expect(isAllowedRedirectUri(client, "https://127.0.0.1/callback")).toBe(false);
    expect(isAllowedRedirectUri(client, "http://0.0.0.0/callback")).toBe(false);
    expect(isAllowedRedirectUri(client, "http://8.8.8.8/callback")).toBe(false);
  });

  it("requires the path to match a registered redirect's path", () => {
    const client = {
      redirectUris: ["http://127.0.0.1/callback"],
      isLoopback: true,
    };
    expect(isAllowedRedirectUri(client, "http://127.0.0.1:8080/other")).toBe(false);
  });
});

describe("buildUserInfo", () => {
  it("derives type from user columns when not provided", () => {
    expect(
      buildUserInfo({
        id: "u",
        daliEmail: "a@dali.dartmouth.edu",
        dartmouthEmail: null,
        netId: null,
        firstName: "A",
        lastName: "B",
      }).type,
    ).toBe("member");

    expect(
      buildUserInfo({
        id: "u",
        daliEmail: null,
        dartmouthEmail: null,
        netId: "x",
        firstName: "A",
        lastName: "B",
      }).type,
    ).toBe("dartmouth");

    expect(
      buildUserInfo({
        id: "u",
        daliEmail: null,
        dartmouthEmail: "x@example.com",
        netId: null,
        firstName: "A",
        lastName: "B",
      }).type,
    ).toBe("partner");
  });

  it("uses an explicit authType when supplied", () => {
    expect(
      buildUserInfo(
        {
          id: "u",
          daliEmail: "a@dali.dartmouth.edu",
          dartmouthEmail: null,
          netId: null,
          firstName: "A",
          lastName: "B",
        },
        "dartmouth",
      ).type,
    ).toBe("dartmouth");
  });
});

describe("exchangeAuthorizationCode", () => {
  const baseParams = {
    code: "auth-code",
    codeVerifier: "test-verifier",
    redirectUri: "http://localhost:5173/login",
    clientId: "dali-api",
  };

  it("throws when session not found", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue(null);
    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "Invalid authorization code",
    );
  });

  it("throws when code already exchanged", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      exchanged: true,
      expiresAt: new Date(Date.now() + 60000),
    });
    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "already used",
    );
  });

  it("throws when code expired", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      exchanged: false,
      expiresAt: new Date(Date.now() - 60000),
    });
    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "expired",
    );
  });

  it("throws on redirect_uri mismatch", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      exchanged: false,
      expiresAt: new Date(Date.now() + 60000),
      redirectUri: "http://evil.com/callback",
    });
    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "redirect_uri mismatch",
    );
  });

  it("throws on invalid client_id", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      exchanged: false,
      expiresAt: new Date(Date.now() + 60000),
      redirectUri: baseParams.redirectUri,
    });
    mockPrisma.oAuthClient.findUnique.mockResolvedValueOnce(null);
    await expect(
      exchangeAuthorizationCode({ ...baseParams, clientId: "bad-client" }),
    ).rejects.toThrow("Unknown client_id");
  });

  it("throws on PKCE failure", async () => {
    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      exchanged: false,
      expiresAt: new Date(Date.now() + 60000),
      redirectUri: baseParams.redirectUri,
      codeChallenge: "wrong-challenge",
      codeChallengeMethod: "S256",
    });
    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "PKCE verification failed",
    );
  });

  it("throws when session has no userId", async () => {
    const { createHash } = await import("node:crypto");
    const challenge = createHash("sha256")
      .update(baseParams.codeVerifier)
      .digest("base64url");

    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      id: "sess1",
      exchanged: false,
      expiresAt: new Date(Date.now() + 60000),
      redirectUri: baseParams.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      userId: null,
      provider: "cas",
      accountType: "dartmouth",
    });

    await expect(exchangeAuthorizationCode(baseParams)).rejects.toThrow(
      "Session has no user",
    );
  });

  it("succeeds and returns userId/provider/accountType", async () => {
    const { createHash } = await import("node:crypto");
    const challenge = createHash("sha256")
      .update(baseParams.codeVerifier)
      .digest("base64url");

    mockPrisma.oAuthSession.findUnique.mockResolvedValue({
      id: "sess1",
      exchanged: false,
      expiresAt: new Date(Date.now() + 60000),
      redirectUri: baseParams.redirectUri,
      codeChallenge: challenge,
      codeChallengeMethod: "S256",
      userId: "user-abc",
      provider: "cas",
      accountType: "dartmouth",
    });

    const result = await exchangeAuthorizationCode(baseParams);
    expect(result).toEqual({
      userId: "user-abc",
      provider: "cas",
      accountType: "dartmouth",
      scopes: [],
      clientId: baseParams.clientId,
    });
  });
});

describe("exchangeGoogleCode", () => {
  beforeEach(() => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: mockGetPayload });
  });

  function mockFetch(body: object, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok,
        text: () => Promise.resolve("error"),
        json: () => Promise.resolve(body),
      }),
    );
  }

  it("throws OAuthError when Google token exchange fails", async () => {
    mockFetch({}, false);
    await expect(
      exchangeGoogleCode("bad-code", "http://localhost/callback"),
    ).rejects.toThrow("Google token exchange failed");
  });

  it("throws OAuthError when payload is null", async () => {
    mockFetch({ id_token: "tok" });
    mockGetPayload.mockReturnValue(null);
    await expect(
      exchangeGoogleCode("code", "http://localhost/callback"),
    ).rejects.toThrow("Failed to verify Google ID token");
  });

  it("throws OAuthError when email_verified is false", async () => {
    mockFetch({ id_token: "tok" });
    mockGetPayload.mockReturnValue({
      email: "user@example.com",
      email_verified: false,
    });
    await expect(
      exchangeGoogleCode("code", "http://localhost/callback"),
    ).rejects.toThrow("Email not verified by Google");
  });

  it("throws OAuthError when email is missing", async () => {
    mockFetch({ id_token: "tok" });
    mockGetPayload.mockReturnValue({ email_verified: true });
    await expect(
      exchangeGoogleCode("code", "http://localhost/callback"),
    ).rejects.toThrow("Email not verified by Google");
  });

  it("returns user info when email and email_verified are valid", async () => {
    mockFetch({
      id_token: "tok",
      access_token: "acc",
      refresh_token: "ref",
      expires_in: 3600,
    });
    mockGetPayload.mockReturnValue({
      email: "user@dali.dartmouth.edu",
      email_verified: true,
      given_name: "Jane",
      family_name: "Doe",
      picture: "https://lh3.googleusercontent.com/a/jane",
    });
    const result = await exchangeGoogleCode("code", "http://localhost/callback");
    expect(result).toEqual({
      email: "user@dali.dartmouth.edu",
      firstName: "Jane",
      lastName: "Doe",
      photoUrl: "https://lh3.googleusercontent.com/a/jane",
      accessToken: "acc",
      refreshToken: "ref",
      expiresIn: 3600,
    });
  });

  it("returns photoUrl: null when Google omits the picture claim", async () => {
    mockFetch({ id_token: "tok" });
    mockGetPayload.mockReturnValue({
      email: "user@dali.dartmouth.edu",
      email_verified: true,
      given_name: "Jane",
      family_name: "Doe",
    });
    const result = await exchangeGoogleCode("code", "http://localhost/callback");
    expect(result.photoUrl).toBeNull();
  });
});
