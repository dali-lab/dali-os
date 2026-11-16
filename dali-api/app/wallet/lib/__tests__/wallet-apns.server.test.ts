import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  statusByToken: {} as Record<string, number | Error>,
  requests: [] as Array<{ headers: Record<string, string>; body: string[] }>,
  connectArgs: [] as unknown[][],
  closed: 0,
  connectError: null as Error | null,
}));

vi.mock("node:http2", async () => {
  const { EventEmitter } = await import("node:events");
  const connect = (...args: unknown[]) => {
    h.connectArgs.push(args);
    const s: any = new EventEmitter();
    s.close = () => {
      h.closed++;
    };
    s.request = (headers: Record<string, string>) => {
      const req: any = new EventEmitter();
      const rec = { headers, body: [] as string[] };
      h.requests.push(rec);
      req.write = (b: string) => rec.body.push(b);
      req.end = () => {
        const token = headers[":path"].replace("/3/device/", "");
        const outcome = h.statusByToken[token] ?? 200;
        queueMicrotask(() => {
          if (outcome instanceof Error) req.emit("error", outcome);
          else req.emit("response", { ":status": outcome });
        });
      };
      return req;
    };
    queueMicrotask(() => (h.connectError ? s.emit("error", h.connectError) : s.emit("connect")));
    return s;
  };
  return { default: { connect }, connect };
});

vi.mock("~/lib/db.server", () => ({
  prisma: {
    user: { update: vi.fn() },
    walletPassRegistration: { findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));
vi.mock("~/wallet/lib/wallet-apple.server", () => ({ walletAppleConfigured: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { walletAppleConfigured } from "~/wallet/lib/wallet-apple.server";
import { pushWalletPassUpdate, pushAllWalletPassUpdates } from "~/wallet/lib/wallet-apns.server";

const m = prisma as any;
const ENV = {
  APPLE_PASS_CERT_PEM: "fake-cert\\nline2",
  APPLE_PASS_KEY_PEM: "fake-key",
  APPLE_PASS_TYPE_ID: "pass.example.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.statusByToken = {};
  h.requests = [];
  h.connectArgs = [];
  h.closed = 0;
  h.connectError = null;
  Object.assign(process.env, ENV);
  vi.mocked(walletAppleConfigured).mockReturnValue(true);
  m.walletPassRegistration.findMany.mockResolvedValue([]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  for (const k of [...Object.keys(ENV), "APPLE_PASS_APNS_HOST", "APPLE_PASS_KEY_PASSPHRASE"]) delete process.env[k];
});

describe("pushWalletPassUpdate", () => {
  it("does nothing at all when Apple Wallet is not configured", async () => {
    vi.mocked(walletAppleConfigured).mockReturnValue(false);
    await pushWalletPassUpdate("u1");
    expect(m.user.update).not.toHaveBeenCalled();
    expect(m.walletPassRegistration.findMany).not.toHaveBeenCalled();
    expect(h.connectArgs).toHaveLength(0);
  });

  it("bumps the update tag but opens no connection when no device has the pass", async () => {
    await pushWalletPassUpdate("u1");
    expect(m.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { walletPassUpdatedAt: expect.any(Date) },
    });
    expect(m.walletPassRegistration.findMany).toHaveBeenCalledWith({ where: { serialNumber: "u1" } });
    expect(h.connectArgs).toHaveLength(0);
  });

  it("pushes an empty payload to every registered device, topic = pass type id", async () => {
    m.walletPassRegistration.findMany.mockResolvedValue([
      { id: "r1", pushToken: "tok-a" },
      { id: "r2", pushToken: "tok-b" },
    ]);
    await pushWalletPassUpdate("u1");
    expect(h.requests.map((r) => r.headers)).toEqual([
      { ":method": "POST", ":path": "/3/device/tok-a", "apns-topic": "pass.example.test", "content-type": "application/json" },
      { ":method": "POST", ":path": "/3/device/tok-b", "apns-topic": "pass.example.test", "content-type": "application/json" },
    ]);
    expect(h.requests.every((r) => r.body.join("") === "{}")).toBe(true);
    expect(h.closed).toBe(1);
    expect(h.connectArgs).toHaveLength(1);
    expect(m.walletPassRegistration.deleteMany).not.toHaveBeenCalled();
  });

  it("authenticates with the pass cert (escaped newlines restored) against the prod host by default", async () => {
    m.walletPassRegistration.findMany.mockResolvedValue([{ id: "r1", pushToken: "tok-a" }]);
    await pushWalletPassUpdate("u1");
    expect(h.connectArgs[0]).toEqual(["https://api.push.apple.com", { cert: "fake-cert\nline2", key: "fake-key" }]);
  });

  it("honours the sandbox host and a key passphrase", async () => {
    process.env.APPLE_PASS_APNS_HOST = "https://api.sandbox.push.apple.com";
    process.env.APPLE_PASS_KEY_PASSPHRASE = "fake-passphrase";
    m.walletPassRegistration.findMany.mockResolvedValue([{ id: "r1", pushToken: "tok-a" }]);
    await pushWalletPassUpdate("u1");
    expect(h.connectArgs[0]).toEqual([
      "https://api.sandbox.push.apple.com",
      { cert: "fake-cert\nline2", key: "fake-key", passphrase: "fake-passphrase" },
    ]);
  });

  it("deletes only registrations APNs reports as gone (410)", async () => {
    m.walletPassRegistration.findMany.mockResolvedValue([
      { id: "r1", pushToken: "tok-a" },
      { id: "r2", pushToken: "tok-dead" },
      { id: "r3", pushToken: "tok-b" },
    ]);
    h.statusByToken = { "tok-dead": 410, "tok-b": 400 };
    await pushWalletPassUpdate("u1");
    expect(m.walletPassRegistration.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["r2"] } } });
  });

  it("keeps going past a device whose push errors, without throwing", async () => {
    m.walletPassRegistration.findMany.mockResolvedValue([
      { id: "r1", pushToken: "tok-bad" },
      { id: "r2", pushToken: "tok-dead" },
    ]);
    h.statusByToken = { "tok-bad": new Error("stream reset"), "tok-dead": 410 };
    await expect(pushWalletPassUpdate("u1")).resolves.toBeUndefined();
    expect(h.requests).toHaveLength(2);
    expect(m.walletPassRegistration.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["r2"] } } });
  });

  it("swallows a failure to open the APNs session and deletes nothing", async () => {
    m.walletPassRegistration.findMany.mockResolvedValue([{ id: "r1", pushToken: "tok-a" }]);
    h.connectError = new Error("ECONNREFUSED");
    await expect(pushWalletPassUpdate("u1")).resolves.toBeUndefined();
    expect(h.requests).toHaveLength(0);
    expect(m.walletPassRegistration.deleteMany).not.toHaveBeenCalled();
  });
});

describe("pushAllWalletPassUpdates", () => {
  beforeEach(() => {
    m.walletPassRegistration.findMany.mockImplementation(async (args: any) =>
      args?.distinct
        ? [{ serialNumber: "u1" }, { serialNumber: "u2" }]
        : [],
    );
  });

  it("counts distinct registered members without pushing on a dry run", async () => {
    expect(await pushAllWalletPassUpdates(false)).toEqual({ users: 2 });
    expect(m.walletPassRegistration.findMany).toHaveBeenCalledWith({
      select: { serialNumber: true },
      distinct: ["serialNumber"],
    });
    expect(m.user.update).not.toHaveBeenCalled();
  });

  it("pushes each member once when committing", async () => {
    expect(await pushAllWalletPassUpdates(true)).toEqual({ users: 2 });
    expect(m.user.update.mock.calls.map((c: any[]) => c[0].where.id)).toEqual(["u1", "u2"]);
  });
});
