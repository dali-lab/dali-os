import { describe, it, expect, beforeEach, vi } from "vitest";

// CI's unit job has no generated Prisma client; keep the real db module out.
vi.mock("~/lib/db", () => ({ prisma: {} }));
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/wallet-token", () => ({ rotateWalletSecret: vi.fn() }));
vi.mock("~/lib/wallet-apns.server", () => ({ pushWalletPassUpdate: vi.fn() }));
vi.mock("~/lib/settings-page.server", () => ({}));

import { requireAuth } from "~/lib/auth";
import { rotateWalletSecret } from "~/lib/wallet-token";
import { pushWalletPassUpdate } from "~/lib/wallet-apns.server";
import { action } from "~/routes/settings.general";

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;

function post(fields: Record<string, string>) {
  const request = new Request("http://localhost/settings/general", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return action({ request, params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  mockAuth.mockResolvedValue({ ok: true, user: { sub: "u1", type: "member" } });
});

describe("settings.general action", () => {
  it("resets the wallet pass and pushes the update to installed passes", async () => {
    expect(await post({ intent: "revoke-wallet-pass" })).toBeNull();
    expect(rotateWalletSecret).toHaveBeenCalledWith("u1");
    expect(pushWalletPassUpdate).toHaveBeenCalledWith("u1");
  });

  it("refuses unknown intents and signed-out callers", async () => {
    expect(await post({ intent: "nope" })).toEqual({ error: "Unknown intent." });
    mockAuth.mockResolvedValue({ ok: false });
    expect(await post({ intent: "revoke-wallet-pass" })).toEqual({ error: "Not authenticated." });
    expect(rotateWalletSecret).not.toHaveBeenCalled();
  });
});
