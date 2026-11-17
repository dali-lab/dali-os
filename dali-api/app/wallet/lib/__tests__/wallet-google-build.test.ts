import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, resolveFields, ensureSecret, signToken, tokensConfigured, jwtOpts } = vi.hoisted(() => ({
  authorize: vi.fn(),
  resolveFields: vi.fn(),
  ensureSecret: vi.fn(),
  signToken: vi.fn(),
  tokensConfigured: vi.fn(),
  jwtOpts: [] as unknown[],
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    constructor(opts: unknown) {
      jwtOpts.push(opts);
    }
    authorize = authorize;
  },
}));
vi.mock("~/wallet/lib/wallet-token.server", () => ({
  walletTokensConfigured: tokensConfigured,
  ensureWalletSecret: ensureSecret,
  signWalletToken: signToken,
}));
vi.mock("~/wallet/lib/wallet-pass-fields.server", () => ({ resolveWalletPassFields: resolveFields }));

import {
  buildGoogleWalletSaveUrl,
  patchAllGoogleWalletObjects,
  walletGoogleConfigured,
} from "~/wallet/lib/wallet-google.server";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const ISSUER = "1234567890";
const ORIGIN = "https://os.example.edu";
const barcodeKey = (token: string) => crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);

const fullFields = {
  name: "Ada Lovelace",
  domainCode: "WEB",
  classYearShort: "'27",
  memberSinceTerm: "26F",
  isCore: true,
};

function decodeSaveUrl(url: string) {
  const jwt = url.replace("https://pay.google.com/gp/v/save/", "");
  const [h, p, s] = jwt.split(".");
  return {
    header: JSON.parse(Buffer.from(h, "base64url").toString()),
    claims: JSON.parse(Buffer.from(p, "base64url").toString()),
    verified: crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  jwtOpts.length = 0;
  vi.stubEnv("GOOGLE_WALLET_ISSUER_ID", ISSUER);
  vi.stubEnv("GOOGLE_WALLET_SA_EMAIL", "sa@example.iam.test");
  vi.stubEnv("GOOGLE_WALLET_SA_PRIVATE_KEY", privateKey);
  tokensConfigured.mockReturnValue(true);
  resolveFields.mockResolvedValue(fullFields);
  ensureSecret.mockResolvedValue("member-secret");
  signToken.mockImplementation((id: string) => `tok-${id}`);
  authorize.mockResolvedValue({ access_token: "fake-access" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("walletGoogleConfigured", () => {
  it("is true only with issuer, service account email, key and the global wallet secret", () => {
    expect(walletGoogleConfigured()).toBe(true);
    for (const name of ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SA_EMAIL", "GOOGLE_WALLET_SA_PRIVATE_KEY"]) {
      const original = process.env[name]!;
      vi.stubEnv(name, "");
      expect(walletGoogleConfigured()).toBe(false);
      vi.stubEnv(name, original);
    }
    tokensConfigured.mockReturnValue(false);
    expect(walletGoogleConfigured()).toBe(false);
  });
});

describe("buildGoogleWalletSaveUrl", () => {
  it("returns a pay.google.com save link with an RS256 JWT verifiable by the service account's public key", async () => {
    const url = await buildGoogleWalletSaveUrl("ada1", ORIGIN);
    expect(url.startsWith("https://pay.google.com/gp/v/save/")).toBe(true);
    const { header, claims, verified } = decodeSaveUrl(url);
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });
    expect(verified).toBe(true);
    expect(claims).toMatchObject({ iss: "sa@example.iam.test", aud: "google", typ: "savetowallet" });
    expect(Math.abs(claims.iat - Date.now() / 1000)).toBeLessThan(5);
  });

  it("accepts a key with escaped newlines, as stored in env files", async () => {
    vi.stubEnv("GOOGLE_WALLET_SA_PRIVATE_KEY", privateKey.replace(/\n/g, "\\n"));
    expect(decodeSaveUrl(await buildGoogleWalletSaveUrl("ada1", ORIGIN)).verified).toBe(true);
  });

  it("embeds the class and a member object keyed by user and barcode", async () => {
    const { claims } = decodeSaveUrl(await buildGoogleWalletSaveUrl("ada1", ORIGIN));
    const classId = `${ISSUER}.dali_membership`;
    expect(claims.payload.genericClasses).toEqual([{ id: classId }]);
    const [obj] = claims.payload.genericObjects;
    expect(obj).toMatchObject({
      id: `${ISSUER}.member_ada1_${barcodeKey("tok-ada1")}`,
      classId,
      state: "ACTIVE",
      cardTitle: { defaultValue: { language: "en-US", value: "DALI Lab" } },
      header: { defaultValue: { language: "en-US", value: "Ada Lovelace" } },
      hexBackgroundColor: "#0C2C47",
      logo: { sourceUri: { uri: `${ORIGIN}/logo-white.png` } },
      heroImage: { sourceUri: { uri: `${ORIGIN}/wallet-hero.png` } },
      barcode: { type: "QR_CODE", value: "tok-ada1" },
    });
    expect(obj.id).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(ensureSecret).toHaveBeenCalledWith("ada1");
    expect(signToken).toHaveBeenCalledWith("ada1", "member-secret");
  });

  it("changes the object id when the barcode token changes", async () => {
    const a = decodeSaveUrl(await buildGoogleWalletSaveUrl("ada1", ORIGIN)).claims.payload.genericObjects[0].id;
    signToken.mockReturnValue("rotated");
    const b = decodeSaveUrl(await buildGoogleWalletSaveUrl("ada1", ORIGIN)).claims.payload.genericObjects[0].id;
    expect(a).not.toBe(b);
  });

  it("shows Domain, Class, Member since and Core role from member data", async () => {
    const { claims } = decodeSaveUrl(await buildGoogleWalletSaveUrl("ada1", ORIGIN));
    expect(claims.payload.genericObjects[0].textModulesData).toEqual([
      { id: "domain", header: "Domain", body: "WEB" },
      { id: "class", header: "Class", body: "'27" },
      { id: "member_since", header: "Member since", body: "26F" },
      { id: "role", header: "Role", body: "Core" },
    ]);
  });

  it("omits fields that are unknown and the Core badge for non-core members", async () => {
    resolveFields.mockResolvedValue({ name: "Grace Hopper", domainCode: null, classYearShort: null, memberSinceTerm: "25W", isCore: false });
    const { claims } = decodeSaveUrl(await buildGoogleWalletSaveUrl("grace1", ORIGIN));
    expect(claims.payload.genericObjects[0].textModulesData).toEqual([
      { id: "member_since", header: "Member since", body: "25W" },
    ]);
  });

  it("propagates a missing user and signs nothing", async () => {
    resolveFields.mockRejectedValue(new Error("User not found"));
    await expect(buildGoogleWalletSaveUrl("nobody", ORIGIN)).rejects.toThrow("User not found");
    expect(signToken).not.toHaveBeenCalled();
  });
});

describe("patchAllGoogleWalletObjects", () => {
  const page = (ids: string[], next?: string) =>
    new Response(JSON.stringify({ resources: ids.map((id) => ({ id })), pagination: next ? { nextPageToken: next } : {} }));

  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("refuses to run when Google Wallet is not configured", async () => {
    tokensConfigured.mockReturnValue(false);
    await expect(patchAllGoogleWalletObjects(ORIGIN, true)).rejects.toThrow("Google Wallet is not configured.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("authorizes the service account with the wallet issuer scope", async () => {
    fetchMock.mockResolvedValue(page([]));
    await patchAllGoogleWalletObjects(ORIGIN, true);
    expect(jwtOpts[0]).toEqual({
      email: "sa@example.iam.test",
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"],
    });
  });

  it("fails if Google returns no access token", async () => {
    authorize.mockResolvedValue({});
    await expect(patchAllGoogleWalletObjects(ORIGIN, true)).rejects.toThrow("No access token");
  });

  it("lists our class's objects, follows pagination and PATCHes each existing object id with the rebuilt body", async () => {
    const id1 = `${ISSUER}.member_ada1_aaaaaaaaaaaa`;
    const id2 = `${ISSUER}.member_grace1_bbbbbbbbbbbb`;
    fetchMock.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      if (init?.method === "PATCH") return new Response("{}");
      return new URL(String(url)).searchParams.get("token") === "next-page" ? page([id2]) : page([id1], "next-page");
    });
    const result = await patchAllGoogleWalletObjects(ORIGIN, true);
    expect(result).toEqual({ total: 2, patched: 2, failed: 0, skipped: 0 });

    const listUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(listUrl.searchParams.get("classId")).toBe(`${ISSUER}.dali_membership`);
    expect(listUrl.searchParams.get("maxResults")).toBe("100");
    expect(listUrl.searchParams.has("token")).toBe(false);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer fake-access");
    const lists = fetchMock.mock.calls.filter((c) => c[1]?.method !== "PATCH");
    expect(lists).toHaveLength(2);
    expect(new URL(String(lists[1][0])).searchParams.get("token")).toBe("next-page");

    const patches = fetchMock.mock.calls.filter((c) => c[1]?.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[0][0]).toBe(`https://walletobjects.googleapis.com/walletobjects/v1/genericObject/${encodeURIComponent(id1)}`);
    const body = JSON.parse(patches[0][1].body);
    expect(body.id).toBe(id1);
    expect(body.barcode.value).toBe("tok-ada1");
    expect(JSON.parse(patches[1][1].body).barcode.value).toBe("tok-grace1");
  });

  it("dry run counts objects without writing", async () => {
    fetchMock.mockResolvedValue(page([`${ISSUER}.member_ada1_aaaaaaaaaaaa`]));
    const result = await patchAllGoogleWalletObjects(ORIGIN, false);
    expect(result).toEqual({ total: 1, patched: 1, failed: 0, skipped: 0 });
    expect(fetchMock.mock.calls.every((c) => c[1]?.method !== "PATCH")).toBe(true);
  });

  it("skips ids it cannot map to a member, and counts per-object failures without aborting", async () => {
    resolveFields.mockImplementation(async (id: string) => {
      if (id === "gone") throw new Error("User not found");
      return fullFields;
    });
    fetchMock.mockImplementation(async (url: unknown, init?: { method?: string }) => {
      if (init?.method !== "PATCH") {
        return page([`${ISSUER}.dali_membership`, `${ISSUER}.member_gone_aaaaaaaaaaaa`, `${ISSUER}.member_ada1_bbbbbbbbbbbb`, `${ISSUER}.member_grace1_cccccccccccc`]);
      }
      return String(url).includes("grace1") ? new Response("denied", { status: 403 }) : new Response("{}");
    });
    const result = await patchAllGoogleWalletObjects(ORIGIN, true);
    expect(result).toEqual({ total: 4, patched: 1, failed: 2, skipped: 1 });
  });

  it("throws when listing fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(patchAllGoogleWalletObjects(ORIGIN, true)).rejects.toThrow("Wallet object list failed: 500 nope");
  });
});
