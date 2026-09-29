import { describe, it, expect, beforeEach, vi } from "vitest";

// A stand-in APIError class so the helper's `instanceof APIError` check works
// against instances we construct here; getSessionFromCtx is a spy we drive.
// Both are built in vi.hoisted so the hoisted vi.mock factory can close over
// them (a plain top-level class would be referenced before initialization).
const { FakeAPIError, mockGetSession } = vi.hoisted(() => {
  class FakeAPIError extends Error {}
  return { FakeAPIError, mockGetSession: vi.fn() };
});
vi.mock("better-auth/api", () => ({
  APIError: FakeAPIError,
  getSessionFromCtx: mockGetSession,
}));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));

import { logAuditEvent } from "~/lib/audit";
import {
  passkeyAuditAction,
  auditPasskeyMutation,
} from "~/lib/betterauth-passkey-audit.server";

const mockAudit = vi.mocked(logAuditEvent);

function ctx(overrides: {
  path?: string;
  returned?: unknown;
  session?: unknown;
  request?: Request;
}) {
  return {
    path: overrides.path,
    request: overrides.request,
    context: { returned: overrides.returned, session: overrides.session },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockAudit.mockResolvedValue(undefined as any);
});

describe("passkeyAuditAction", () => {
  it("maps the register + delete endpoints, null otherwise", () => {
    expect(passkeyAuditAction("/passkey/verify-registration")).toBe("auth.passkey.register");
    expect(passkeyAuditAction("/passkey/delete-passkey")).toBe("auth.passkey.remove");
    expect(passkeyAuditAction("/passkey/generate-register-options")).toBeNull();
    expect(passkeyAuditAction("/sign-in/email")).toBeNull();
    expect(passkeyAuditAction(undefined)).toBeNull();
  });
});

describe("auditPasskeyMutation", () => {
  it("logs a registration with the session user id", async () => {
    await auditPasskeyMutation(
      ctx({
        path: "/passkey/verify-registration",
        returned: { id: "pk1", userId: "u1" },
        session: { user: { id: "u1" } },
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.passkey.register", userId: "u1" }),
    );
  });

  it("logs a removal", async () => {
    await auditPasskeyMutation(
      ctx({
        path: "/passkey/delete-passkey",
        returned: { status: true },
        session: { user: { id: "u2" } },
      }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.passkey.remove", userId: "u2" }),
    );
  });

  it("does not log for a non-passkey endpoint", async () => {
    await auditPasskeyMutation(ctx({ path: "/sign-in/email", session: { user: { id: "u1" } } }));
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("does not log when the endpoint returned an APIError (failed ceremony)", async () => {
    await auditPasskeyMutation(
      ctx({
        path: "/passkey/verify-registration",
        returned: new FakeAPIError("bad"),
        session: { user: { id: "u1" } },
      }),
    );
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("falls back to getSessionFromCtx when the context has no cached session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u3" } });
    await auditPasskeyMutation(
      ctx({ path: "/passkey/delete-passkey", returned: { status: true } }),
    );
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.passkey.remove", userId: "u3" }),
    );
  });

  it("falls back to the returned passkey userId for a registration with no session", async () => {
    await auditPasskeyMutation(
      ctx({ path: "/passkey/verify-registration", returned: { id: "pk9", userId: "u9" } }),
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.passkey.register", userId: "u9" }),
    );
  });

  it("does not log when no user id can be resolved", async () => {
    await auditPasskeyMutation(
      ctx({ path: "/passkey/delete-passkey", returned: { status: true } }),
    );
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
