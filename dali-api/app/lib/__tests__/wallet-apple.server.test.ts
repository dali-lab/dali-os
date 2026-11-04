import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const passes: any[] = [];
vi.mock("passkit-generator", () => ({
  PKPass: class {
    props: any;
    certs: any;
    type = "";
    primaryFields: any[] = [];
    secondaryFields: any[] = [];
    auxiliaryFields: any[] = [];
    barcodes: any;
    buffers: Record<string, Buffer> = {};
    constructor(_files: unknown, certs: unknown, props: unknown) {
      this.certs = certs;
      this.props = props;
      passes.push(this);
    }
    setBarcodes(b: unknown) {
      this.barcodes = b;
    }
    addBuffer(name: string, buf: Buffer) {
      this.buffers[name] = buf;
    }
    getAsBuffer() {
      return Buffer.from("pkpass-bytes");
    }
  },
}));
vi.mock("node:fs", () => {
  const fs = {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn((p: string) => Buffer.from(`asset:${p}`)),
  };
  return { default: fs, ...fs };
});
vi.mock("~/lib/db.server", () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("~/lib/wallet-token", () => ({
  walletTokensConfigured: vi.fn(() => true),
  signWalletToken: vi.fn((id: string, secret: string) => `token:${id}:${secret}`),
  ensureWalletSecret: vi.fn(async () => "member-secret"),
  signWalletAuthToken: vi.fn((id: string) => `auth:${id}`),
}));
vi.mock("~/lib/wallet-pass-fields.server", () => ({ resolveWalletPassFields: vi.fn() }));
vi.mock("~/lib/app-env", () => ({ getApiBaseUrl: () => "https://api.example.edu" }));

import fs from "node:fs";
import { prisma } from "~/lib/db.server";
import { walletTokensConfigured } from "~/lib/wallet-token";
import { resolveWalletPassFields } from "~/lib/wallet-pass-fields.server";
import { walletAppleConfigured, buildAppleWalletPass } from "~/lib/wallet-apple.server";

const m = prisma as any;
const ENV = {
  APPLE_PASS_CERT_PEM: "fake-cert\\nline2",
  APPLE_PASS_KEY_PEM: "fake-key\\nline2",
  APPLE_WWDR_CERT_PEM: "fake-wwdr",
  APPLE_PASS_TYPE_ID: "pass.example.test",
  APPLE_TEAM_ID: "TEAM123456",
};
const FIELDS = {
  name: "Ada Lovelace",
  domainCode: "FS",
  classYearShort: "'27",
  memberSinceTerm: "24F",
  isCore: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  passes.length = 0;
  Object.assign(process.env, ENV);
  delete process.env.APPLE_PASS_KEY_PASSPHRASE;
  vi.mocked(walletTokensConfigured).mockReturnValue(true);
  vi.mocked(resolveWalletPassFields).mockResolvedValue(FIELDS as never);
  m.user.findUnique.mockResolvedValue({ walletPassUpdatedAt: new Date() });
  vi.mocked(fs.existsSync).mockReturnValue(true);
});
afterEach(() => {
  for (const k of [...Object.keys(ENV), "APPLE_PASS_KEY_PASSPHRASE"]) delete process.env[k];
});

describe("walletAppleConfigured", () => {
  it("is true only when every cert, id and the wallet token secret are present", () => {
    expect(walletAppleConfigured()).toBe(true);
  });

  it.each(Object.keys(ENV))("is false when %s is missing", (key) => {
    delete process.env[key];
    expect(walletAppleConfigured()).toBe(false);
  });

  it("is false when the wallet token secret is not configured", () => {
    vi.mocked(walletTokensConfigured).mockReturnValue(false);
    expect(walletAppleConfigured()).toBe(false);
  });
});

describe("buildAppleWalletPass", () => {
  it("returns the signed archive bytes", async () => {
    expect((await buildAppleWalletPass("u1")).toString()).toBe("pkpass-bytes");
  });

  it("identifies the pass by the member's id and points the device at our web service", async () => {
    await buildAppleWalletPass("u1");
    expect(passes[0].props).toMatchObject({
      passTypeIdentifier: "pass.example.test",
      teamIdentifier: "TEAM123456",
      serialNumber: "u1",
      webServiceURL: "https://api.example.edu/api/wallet/apple",
      authenticationToken: "auth:u1",
    });
  });

  it("is a storeCard with the member name as the primary field", async () => {
    await buildAppleWalletPass("u1");
    expect(passes[0].type).toBe("storeCard");
    expect(passes[0].primaryFields).toEqual([{ key: "member", value: "Ada Lovelace" }]);
  });

  it("fills the field grid and the Core badge from the resolved fields", async () => {
    await buildAppleWalletPass("u1");
    expect(passes[0].secondaryFields).toEqual([
      { key: "domain", label: "DOMAIN", value: "FS" },
      { key: "class", label: "CLASS", value: "'27" },
    ]);
    expect(passes[0].auxiliaryFields).toEqual([
      { key: "memberSince", label: "MEMBER SINCE", value: "24F" },
      { key: "core", label: "ROLE", value: "Core" },
    ]);
  });

  it("omits cells it has no value for, and the Core badge for non-Core members", async () => {
    vi.mocked(resolveWalletPassFields).mockResolvedValue({
      name: "Grace Hopper",
      domainCode: null,
      classYearShort: null,
      memberSinceTerm: null,
      isCore: false,
    } as never);
    await buildAppleWalletPass("u2");
    expect(passes[0].secondaryFields).toEqual([]);
    expect(passes[0].auxiliaryFields).toEqual([]);
  });

  it("puts the member's signed token in a QR barcode", async () => {
    await buildAppleWalletPass("u1");
    expect(passes[0].barcodes).toEqual({
      format: "PKBarcodeFormatQR",
      message: "token:u1:member-secret",
      messageEncoding: "iso-8859-1",
    });
  });

  it("un-escapes literal \\n sequences in the PEMs from env", async () => {
    await buildAppleWalletPass("u1");
    expect(passes[0].certs).toEqual({
      wwdr: "fake-wwdr",
      signerCert: "fake-cert\nline2",
      signerKey: "fake-key\nline2",
    });
  });

  it("passes the key passphrase only when one is set", async () => {
    process.env.APPLE_PASS_KEY_PASSPHRASE = "fake-passphrase";
    await buildAppleWalletPass("u1");
    expect(passes[0].certs.signerKeyPassphrase).toBe("fake-passphrase");
  });

  it("attaches the icon, logo and three strip resolutions", async () => {
    await buildAppleWalletPass("u1");
    expect(Object.keys(passes[0].buffers).sort()).toEqual(
      ["icon.png", "icon@2x.png", "logo.png", "logo@2x.png", "strip.png", "strip@2x.png", "strip@3x.png"],
    );
  });

  it("falls back to build/client when public/ lacks the brand assets", async () => {
    vi.mocked(fs.existsSync).mockImplementation(((p: string) => p.includes("/build/client/")) as never);
    await buildAppleWalletPass("u1");
    expect(passes[0].buffers["icon.png"].toString()).toContain("/build/client/icon-white.png");
  });

  it("throws when a brand asset is in neither location", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await expect(buildAppleWalletPass("u1")).rejects.toThrow("Wallet pass asset not found: icon-white.png");
  });

  it("baselines walletPassUpdatedAt on the first download only", async () => {
    m.user.findUnique.mockResolvedValue({ walletPassUpdatedAt: null });
    await buildAppleWalletPass("u1");
    expect(m.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { walletPassUpdatedAt: expect.any(Date) },
    });
    m.user.update.mockClear();
    m.user.findUnique.mockResolvedValue({ walletPassUpdatedAt: new Date() });
    await buildAppleWalletPass("u1");
    expect(m.user.update).not.toHaveBeenCalled();
  });

  it("propagates a missing user and builds nothing", async () => {
    vi.mocked(resolveWalletPassFields).mockRejectedValue(new Error("User not found"));
    await expect(buildAppleWalletPass("ghost")).rejects.toThrow("User not found");
    expect(passes).toHaveLength(0);
  });
});
