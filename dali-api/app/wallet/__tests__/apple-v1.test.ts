import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    walletPassRegistration: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("~/wallet/lib/wallet-apple.server", () => ({
  walletAppleConfigured: vi.fn(),
  buildAppleWalletPass: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { walletAppleConfigured, buildAppleWalletPass } from "~/wallet/lib/wallet-apple.server";
import { signWalletAuthToken } from "~/wallet/lib/wallet-token.server";
import { action as registration } from "~/wallet/routes/api.wallet.apple.v1.device-registration";
import { loader as serials } from "~/wallet/routes/api.wallet.apple.v1.device-serials";
import { loader as passLoader } from "~/wallet/routes/api.wallet.apple.v1.pass";
import { action as logAction } from "~/wallet/routes/api.wallet.apple.v1.log";

const m = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;
const reg = prisma.walletPassRegistration;

const PASS_TYPE = "pass.example.test";
const DEVICE = "dev1";
const ADA = "user-ada";
const BOB = "user-bob";

function auth(serial: string) {
  return { Authorization: `ApplePass ${signWalletAuthToken(serial)}` };
}

function callReg(
  method: string,
  opts: { serial?: string; headers?: Record<string, string>; body?: string; passType?: string } = {},
) {
  const serial = opts.serial ?? ADA;
  const request = new Request("http://x/reg", {
    method,
    headers: { "content-type": "application/json", ...(opts.headers ?? auth(serial)) },
    body: method === "GET" ? undefined : (opts.body ?? JSON.stringify({ pushToken: "push1" })),
  });
  return registration({
    request,
    params: {
      deviceLibraryIdentifier: DEVICE,
      passTypeIdentifier: opts.passType ?? PASS_TYPE,
      serialNumber: serial,
    },
  } as unknown as Parameters<typeof registration>[0]) as Promise<Response>;
}

function callSerials(query = "", passType = PASS_TYPE) {
  return serials({
    request: new Request(`http://x/serials${query}`),
    params: { deviceLibraryIdentifier: DEVICE, passTypeIdentifier: passType },
  } as unknown as Parameters<typeof serials>[0]) as Promise<Response>;
}

function callPass(opts: { serial?: string; headers?: Record<string, string>; passType?: string } = {}) {
  const serial = opts.serial ?? ADA;
  return passLoader({
    request: new Request("http://x/pass", { headers: opts.headers ?? auth(serial) }),
    params: { passTypeIdentifier: opts.passType ?? PASS_TYPE, serialNumber: serial },
  } as unknown as Parameters<typeof passLoader>[0]) as Promise<Response>;
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.WALLET_PASS_SECRET = "test-wallet-secret";
  process.env.APPLE_PASS_TYPE_ID = PASS_TYPE;
});

afterEach(() => {
  delete process.env.WALLET_PASS_SECRET;
  delete process.env.APPLE_PASS_TYPE_ID;
});

describe("device registration", () => {
  it("404s a wrong pass type without touching the db", async () => {
    expect((await callReg("POST", { passType: "pass.other" })).status).toBe(404);
    expect(reg.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ["missing header", {}],
    ["wrong scheme", { Authorization: "Bearer abc" }],
    ["garbage token", { Authorization: "ApplePass garbage" }],
  ])("401s on %s", async (_n, headers) => {
    expect((await callReg("POST", { headers })).status).toBe(401);
    expect(reg.upsert).not.toHaveBeenCalled();
  });

  it("401s when the token belongs to another member's serial", async () => {
    const res = await callReg("POST", { serial: BOB, headers: auth(ADA) });
    expect(res.status).toBe(401);
    expect(reg.upsert).not.toHaveBeenCalled();
  });

  it("401s when wallet tokens are not configured", async () => {
    const headers = auth(ADA);
    delete process.env.WALLET_PASS_SECRET;
    expect((await callReg("POST", { headers })).status).toBe(401);
    expect(reg.upsert).not.toHaveBeenCalled();
  });

  it("201s and upserts a new device", async () => {
    m(reg.findUnique).mockResolvedValue(null);
    expect((await callReg("POST")).status).toBe(201);
    expect(reg.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { deviceLibraryIdentifier: DEVICE, serialNumber: ADA, pushToken: "push1" },
        update: { pushToken: "push1" },
      }),
    );
  });

  it("200s for an existing registration", async () => {
    m(reg.findUnique).mockResolvedValue({ id: "r1" });
    expect((await callReg("POST")).status).toBe(200);
    expect(reg.upsert).toHaveBeenCalled();
  });

  it.each([["invalid JSON", "{nope"], ["missing pushToken", "{}"]])("400s on %s", async (_n, body) => {
    expect((await callReg("POST", { body })).status).toBe(400);
    expect(reg.upsert).not.toHaveBeenCalled();
  });

  it("DELETE scopes deleteMany to both ids and 200s even when nothing matched", async () => {
    m(reg.deleteMany).mockResolvedValue({ count: 0 });
    expect((await callReg("DELETE")).status).toBe(200);
    expect(reg.deleteMany).toHaveBeenCalledWith({
      where: { deviceLibraryIdentifier: DEVICE, serialNumber: ADA },
    });
  });

  it("405s other methods after auth", async () => {
    expect((await callReg("PUT")).status).toBe(405);
  });
});

describe("device serials", () => {
  const T1 = new Date("2026-01-01T00:00:00Z");
  const T2 = new Date("2026-02-01T00:00:00Z");

  it("404s a wrong pass type", async () => {
    expect((await callSerials("", "pass.other")).status).toBe(404);
    expect(reg.findMany).not.toHaveBeenCalled();
  });

  it("204s with no registrations", async () => {
    m(reg.findMany).mockResolvedValue([]);
    expect((await callSerials()).status).toBe(204);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("looks up only users registered to the device and drops null update times", async () => {
    m(reg.findMany).mockResolvedValue([{ serialNumber: ADA }, { serialNumber: BOB }]);
    m(prisma.user.findMany).mockResolvedValue([
      { id: ADA, walletPassUpdatedAt: T1 },
      { id: BOB, walletPassUpdatedAt: null },
    ]);
    const res = await callSerials();
    expect(reg.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deviceLibraryIdentifier: DEVICE } }),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [ADA, BOB] } } }),
    );
    expect(await res.json()).toEqual({ serialNumbers: [ADA], lastUpdated: String(T1.getTime()) });
  });

  it("returns the max update time and filters strictly greater than passesUpdatedSince", async () => {
    m(reg.findMany).mockResolvedValue([{ serialNumber: ADA }, { serialNumber: BOB }]);
    m(prisma.user.findMany).mockResolvedValue([
      { id: ADA, walletPassUpdatedAt: T1 },
      { id: BOB, walletPassUpdatedAt: T2 },
    ]);
    expect(await (await callSerials()).json()).toEqual({
      serialNumbers: [ADA, BOB],
      lastUpdated: String(T2.getTime()),
    });
    expect(await (await callSerials(`?passesUpdatedSince=${T1.getTime()}`)).json()).toEqual({
      serialNumbers: [BOB],
      lastUpdated: String(T2.getTime()),
    });
    expect((await callSerials(`?passesUpdatedSince=${T2.getTime()}`)).status).toBe(204);
  });

  it("204s on a non-numeric passesUpdatedSince", async () => {
    m(reg.findMany).mockResolvedValue([{ serialNumber: ADA }]);
    m(prisma.user.findMany).mockResolvedValue([{ id: ADA, walletPassUpdatedAt: T1 }]);
    expect((await callSerials("?passesUpdatedSince=abc")).status).toBe(204);
  });
});

describe("pass", () => {
  const UPDATED = new Date("2026-03-01T12:00:00Z");

  beforeEach(() => {
    m(walletAppleConfigured).mockReturnValue(true);
    m(prisma.user.findUnique).mockResolvedValue({ walletPassUpdatedAt: UPDATED });
    m(buildAppleWalletPass).mockResolvedValue(Buffer.from("pkpass"));
  });

  it("404s a wrong pass type", async () => {
    expect((await callPass({ passType: "pass.other" })).status).toBe(404);
  });

  it("401s a bad token and a token for another serial", async () => {
    expect((await callPass({ headers: { Authorization: "ApplePass nope" } })).status).toBe(401);
    expect((await callPass({ serial: BOB, headers: auth(ADA) })).status).toBe(401);
    expect(buildAppleWalletPass).not.toHaveBeenCalled();
  });

  it("503s when Apple is not configured", async () => {
    m(walletAppleConfigured).mockReturnValue(false);
    expect((await callPass()).status).toBe(503);
  });

  it("404s an unknown user", async () => {
    m(prisma.user.findUnique).mockResolvedValue(null);
    expect((await callPass()).status).toBe(404);
  });

  it("304s when If-Modified-Since is at or after the update time", async () => {
    const res = await callPass({
      headers: { ...auth(ADA), "If-Modified-Since": UPDATED.toUTCString() },
    });
    expect(res.status).toBe(304);
    expect(buildAppleWalletPass).not.toHaveBeenCalled();
  });

  it("builds the pass when If-Modified-Since is unparseable or older", async () => {
    for (const since of ["garbage", "Mon, 01 Jan 2024 00:00:00 GMT"]) {
      expect((await callPass({ headers: { ...auth(ADA), "If-Modified-Since": since } })).status).toBe(200);
    }
  });

  it("returns the pkpass with content type and Last-Modified", async () => {
    const res = await callPass();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/vnd.apple.pkpass");
    expect(res.headers.get("Last-Modified")).toBe(UPDATED.toUTCString());
    expect(buildAppleWalletPass).toHaveBeenCalledWith(ADA);
  });
});

describe("log", () => {
  function callLog(body: string) {
    return logAction({
      request: new Request("http://x/log", { method: "POST", body }),
    } as unknown as Parameters<typeof logAction>[0]) as Promise<Response>;
  }
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("200s on invalid JSON without logging", async () => {
    expect((await callLog("{nope")).status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs an array of strings", async () => {
    await callLog(JSON.stringify({ logs: ["a", "b"] }));
    expect(warn).toHaveBeenCalledWith("[wallet-passkit] device logs:", ["a", "b"]);
  });

  it("caps entries at 20, truncates each to 1000 chars and drops non-strings", async () => {
    const logs = [1, null, { x: 1 }, "x".repeat(5000), ...Array.from({ length: 40 }, (_, i) => `l${i}`)];
    await callLog(JSON.stringify({ logs }));
    const logged = warn.mock.calls[0][1] as string[];
    expect(logged).toHaveLength(20);
    expect(logged.every((l) => typeof l === "string" && l.length <= 1000)).toBe(true);
    expect(logged[0]).toHaveLength(1000);
  });

  it("does not log a non-array or an empty result", async () => {
    await callLog(JSON.stringify({ logs: "text" }));
    await callLog(JSON.stringify({ logs: [1, 2] }));
    expect(warn).not.toHaveBeenCalled();
  });
});
