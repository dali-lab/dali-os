import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

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
  getAllowedRedirectUris,
  exchangeAuthorizationCode,
  exchangeGoogleCode,
  refreshTokens,
  revokeToken,
} from "~/lib/oauth";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  refreshToken: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  oAuthSession: {
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
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

describe("getAllowedRedirectUris", () => {
  it("returns frontend login URI", () => {
    const uris = getAllowedRedirectUris();
    expect(uris).toContain("http://localhost:5173/login");
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
    mockPrisma.oAuthSession.update.mockResolvedValue({});

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
    mockPrisma.oAuthSession.update.mockResolvedValue({});

    const result = await exchangeAuthorizationCode(baseParams);
    expect(result).toEqual({
      userId: "user-abc",
      provider: "cas",
      accountType: "dartmouth",
    });
  });
});

describe("refreshTokens", () => {
  const mockUser = {
    id: "u1",
    daliEmail: "a@dali.dartmouth.edu",
    dartmouthEmail: null,
    netId: "d12345a",
    firstName: "Jane",
    lastName: "Doe",
  };

  it("throws when token not found", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(refreshTokens("unknown-token")).rejects.toThrow(
      "Invalid refresh token",
    );
  });

  it("revokes family on token reuse", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      family: "fam1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      userId: "u1",
    });

    await expect(refreshTokens("reused-token")).rejects.toThrow(
      "family revoked",
    );
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { family: "fam1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("throws when token is expired", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      family: "fam1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60000),
      userId: "u1",
    });
    await expect(refreshTokens("expired-token")).rejects.toThrow(
      "Refresh token expired",
    );
  });

  it("succeeds with token rotation", async () => {
    const familyCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      family: "fam1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      userId: "u1",
      familyCreatedAt,
    });
    mockPrisma.refreshToken.update.mockResolvedValue({});
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const result = await refreshTokens("valid-token");
    expect(result.access_token).toBeDefined();
    expect(result.refresh_token).toBeDefined();
    expect(result.token_type).toBe("Bearer");
    expect(result.expires_in).toBe(900);
    expect(result.userInfo.id).toBe("u1");

    // old token was revoked
    expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: "rt1" },
      data: { revokedAt: expect.any(Date) },
    });
    // familyCreatedAt propagated to new token
    expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ familyCreatedAt }) }),
    );
  });

  it("throws when session exceeds 30-day absolute cap", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      family: "fam1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      userId: "u1",
      familyCreatedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    });
    await expect(refreshTokens("old-session-token")).rejects.toThrow(
      "Session expired",
    );
  });
});

describe("revokeToken", () => {
  it("revokes the token family", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: "rt1",
      family: "fam1",
    });
    mockPrisma.refreshToken.updateMany.mockResolvedValue({});

    await revokeToken("some-token");
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { family: "fam1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("is a no-op for unknown token", async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
    await revokeToken("unknown-token");
    expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
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
    });
    const result = await exchangeGoogleCode("code", "http://localhost/callback");
    expect(result).toEqual({
      email: "user@dali.dartmouth.edu",
      firstName: "Jane",
      lastName: "Doe",
      accessToken: "acc",
      refreshToken: "ref",
      expiresIn: 3600,
    });
  });
});
