import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const m = vi.hoisted(() => ({
  ctor: vi.fn(),
  listen: vi.fn(),
  redisExt: vi.fn(),
  ioredis: vi.fn(),
  verifyCollabToken: vi.fn(),
  loadDocument: vi.fn(),
  storeDocument: vi.fn(),
  maybeSnapshot: vi.fn(),
  authorizeCollabDoc: vi.fn(),
  notifyCollabDocMentions: vi.fn(),
  reconcilePageLinks: vi.fn(),
  attachAgentPresence: vi.fn(),
}));

vi.mock("@hocuspocus/server", () => ({
  Server: class {
    hocuspocus = { id: "hp" };
    listen = m.listen;
    constructor(...args: unknown[]) {
      m.ctor(...args);
    }
  },
}));
vi.mock("@hocuspocus/extension-redis", () => ({
  Redis: class {
    constructor(opts: unknown) {
      m.redisExt(opts);
    }
  },
}));
vi.mock("ioredis", () => ({
  default: class {
    constructor(...args: unknown[]) {
      m.ioredis(...args);
    }
  },
}));
vi.mock("../auth", () => ({ verifyCollabToken: m.verifyCollabToken }));
vi.mock("../persistence", () => ({
  loadDocument: m.loadDocument,
  storeDocument: m.storeDocument,
  maybeSnapshot: m.maybeSnapshot,
}));
vi.mock("~/lib/collabAuth", () => ({ authorizeCollabDoc: m.authorizeCollabDoc }));
vi.mock("../mentions.server", () => ({ notifyCollabDocMentions: m.notifyCollabDocMentions }));
vi.mock("../page-links.server", () => ({ reconcilePageLinks: m.reconcilePageLinks }));
vi.mock("../agent-presence.server", () => ({ attachAgentPresence: m.attachAgentPresence }));

type Hooks = Record<string, (arg: any) => Promise<any>>;

async function boot() {
  vi.resetModules();
  const mod = await import("../server");
  const server = mod.startCollabServer();
  const [config, wsOptions] = m.ctor.mock.calls.at(-1)!;
  return { mod, server, config: config as Record<string, any> & Hooks, wsOptions };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const auth = (config: Hooks, over: Record<string, unknown> = {}) => {
  const connectionConfig = { readOnly: false };
  const p = config.onAuthenticate({ token: "tok", documentName: "task:t1:description", connectionConfig, ...over });
  return { p, connectionConfig };
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REDIS_URL;
  delete process.env.COLLAB_PORT;
  m.listen.mockResolvedValue(undefined);
  m.verifyCollabToken.mockResolvedValue({ sub: "ada" });
  m.authorizeCollabDoc.mockResolvedValue({ allowed: true, readOnly: false });
  m.storeDocument.mockResolvedValue({ state: new Uint8Array(), plainText: "x" });
  m.maybeSnapshot.mockResolvedValue(true);
  m.notifyCollabDocMentions.mockResolvedValue(undefined);
  m.reconcilePageLinks.mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.REDIS_URL;
  delete process.env.COLLAB_PORT;
});

describe("startCollabServer", () => {
  it("is a singleton: a second call returns the same server without rebuilding it", async () => {
    const { mod, server } = await boot();
    expect(mod.startCollabServer()).toBe(server);
    expect(mod.getCollabServer()).toBe(server);
    expect(m.ctor).toHaveBeenCalledTimes(1);
  });

  it("getCollabServer is null before start", async () => {
    vi.resetModules();
    expect((await import("../server")).getCollabServer()).toBeNull();
  });

  it("defaults to port 3002, honours COLLAB_PORT, debounces 2s and caps payloads at 1 MB", async () => {
    const a = await boot();
    expect(a.config.port).toBe(3002);
    expect(a.config.debounce).toBe(2000);
    expect(a.wsOptions).toEqual({ maxPayload: 4_194_304 });

    process.env.COLLAB_PORT = "4555";
    const b = await boot();
    expect(b.config.port).toBe(4555);
  });

  it("adds no extensions and warns when REDIS_URL is unset", async () => {
    const { config } = await boot();
    expect(config.extensions).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("REDIS_URL not set"));
  });

  it("wires Redis fan-out from REDIS_URL with unlimited retries", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";
    const { config } = await boot();
    expect(m.ioredis).toHaveBeenCalledWith("redis://example.test:6379", { maxRetriesPerRequest: null });
    expect(config.extensions).toHaveLength(1);
    expect(m.redisExt).toHaveBeenCalledOnce();
  });

  it("attaches agent presence to the Hocuspocus instance and starts listening", async () => {
    await boot();
    expect(m.attachAgentPresence).toHaveBeenCalledWith({ id: "hp" });
    expect(m.listen).toHaveBeenCalledOnce();
  });

  it("treats EADDRINUSE as benign and logs other listen failures", async () => {
    m.listen.mockRejectedValueOnce({ code: "EADDRINUSE" });
    await boot();
    await flush();
    expect(console.error).not.toHaveBeenCalled();

    m.listen.mockRejectedValueOnce(new Error("boom"));
    await boot();
    await flush();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to start"), expect.any(Error));
  });
});

describe("onAuthenticate", () => {
  it("rejects a missing token without verifying anything", async () => {
    const { config } = await boot();
    await expect(auth(config, { token: "" }).p).rejects.toThrow("No authentication token");
    expect(m.verifyCollabToken).not.toHaveBeenCalled();
  });

  it("propagates a token verification failure", async () => {
    m.verifyCollabToken.mockRejectedValue(new Error("Session revoked"));
    const { config } = await boot();
    await expect(auth(config).p).rejects.toThrow("Session revoked");
    expect(m.authorizeCollabDoc).not.toHaveBeenCalled();
  });

  it("authorizes the verified user against the document and returns the user as context", async () => {
    const { config } = await boot();
    const { p, connectionConfig } = auth(config);
    await expect(p).resolves.toEqual({ user: { sub: "ada" } });
    expect(m.verifyCollabToken).toHaveBeenCalledWith("tok");
    expect(m.authorizeCollabDoc).toHaveBeenCalledWith("ada", "task:t1:description");
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("rejects a user who is not authorized for the document", async () => {
    m.authorizeCollabDoc.mockResolvedValue({ allowed: false, readOnly: false });
    const { config } = await boot();
    await expect(auth(config).p).rejects.toThrow("User ada not authorized for document task:t1:description");
  });

  it("marks the connection read-only when authorization says viewer-only", async () => {
    m.authorizeCollabDoc.mockResolvedValue({ allowed: true, readOnly: true });
    const { config } = await boot();
    const { p, connectionConfig } = auth(config);
    await p;
    expect(connectionConfig.readOnly).toBe(true);
  });

  it("lets any authenticated user into a presence room without document authorization", async () => {
    m.authorizeCollabDoc.mockResolvedValue({ allowed: false, readOnly: true });
    const { config } = await boot();
    const { p, connectionConfig } = auth(config, { documentName: "presence:page1" });
    await expect(p).resolves.toEqual({ user: { sub: "ada" } });
    expect(m.authorizeCollabDoc).not.toHaveBeenCalled();
    expect(connectionConfig.readOnly).toBe(false);
  });

  it("allows 20 connections per user and rejects the 21st", async () => {
    const { config } = await boot();
    for (let i = 0; i < 20; i++) await auth(config).p;
    await expect(auth(config).p).rejects.toThrow("Too many connections for this user");
    m.verifyCollabToken.mockResolvedValue({ sub: "grace" });
    await expect(auth(config).p).resolves.toEqual({ user: { sub: "grace" } });
  });

  it("does not count rejected connections toward the limits", async () => {
    m.authorizeCollabDoc.mockResolvedValue({ allowed: false, readOnly: false });
    const { config } = await boot();
    for (let i = 0; i < 30; i++) await auth(config).p.catch(() => {});
    m.authorizeCollabDoc.mockResolvedValue({ allowed: true, readOnly: false });
    for (let i = 0; i < 20; i++) await auth(config).p;
  });

  it("caps the server at 100 connections across users", async () => {
    const { config } = await boot();
    for (let i = 0; i < 100; i++) {
      m.verifyCollabToken.mockResolvedValue({ sub: `user-${i}` });
      await auth(config).p;
    }
    m.verifyCollabToken.mockResolvedValue({ sub: "one-more" });
    await expect(auth(config).p).rejects.toThrow("Too many connections");
  });
});

describe("onDisconnect connection accounting", () => {
  const disconnect = (config: Hooks, sub = "ada") =>
    config.onDisconnect({ documentName: "task:t1:description", document: {}, context: { user: { sub } } });

  it("frees a per-user slot", async () => {
    const { config } = await boot();
    for (let i = 0; i < 20; i++) await auth(config).p;
    await disconnect(config);
    await expect(auth(config).p).resolves.toBeDefined();
    await expect(auth(config).p).rejects.toThrow("Too many connections for this user");
  });

  it("frees a global slot", async () => {
    const { config } = await boot();
    for (let i = 0; i < 100; i++) {
      m.verifyCollabToken.mockResolvedValue({ sub: `user-${i}` });
      await auth(config).p;
    }
    await disconnect(config, "user-0");
    m.verifyCollabToken.mockResolvedValue({ sub: "newcomer" });
    await expect(auth(config).p).resolves.toBeDefined();
  });

  it("never drives the global count negative", async () => {
    const { config } = await boot();
    await config.onDisconnect({ documentName: "d", document: {}, context: undefined });
    await config.onDisconnect({ documentName: "d", document: {}, context: undefined });
    for (let i = 0; i < 20; i++) await auth(config).p;
  });
});

describe("onLoadDocument", () => {
  it("delegates to loadDocument and returns the same document", async () => {
    const { config } = await boot();
    const document = { doc: true };
    await expect(config.onLoadDocument({ document, documentName: "task:t1:description" })).resolves.toBe(document);
    expect(m.loadDocument).toHaveBeenCalledWith("task:t1:description", document);
  });

  it("propagates a load failure so Hocuspocus does not serve an empty doc", async () => {
    m.loadDocument.mockRejectedValue(new Error("db down"));
    const { config } = await boot();
    await expect(config.onLoadDocument({ document: {}, documentName: "d" })).rejects.toThrow("db down");
  });
});

describe.each([
  ["onStoreDocument", (c: Hooks, document: object) => c.onStoreDocument({ documentName: "doc:p1:body", document })],
  ["onDisconnect", (c: Hooks, document: object) => c.onDisconnect({ documentName: "doc:p1:body", document, context: {} })],
])("%s persistence side effects", (_name, run) => {
  const edit = (config: Hooks, sub: string) => config.onChange({ documentName: "doc:p1:body", context: { user: { sub } } });

  it("stores the doc, then notifies mentions, reconciles page links and snapshots with the edit authors", async () => {
    const { config } = await boot();
    const document = { d: 1 };
    await edit(config, "ada");
    await edit(config, "ada");
    await edit(config, "grace");
    await run(config, document);

    expect(m.storeDocument).toHaveBeenCalledWith("doc:p1:body", document);
    expect(m.notifyCollabDocMentions).toHaveBeenCalledWith("doc:p1:body", document, ["ada", "grace"]);
    expect(m.reconcilePageLinks).toHaveBeenCalledWith("doc:p1:body", document);
    expect(m.maybeSnapshot).toHaveBeenCalledWith("doc:p1:body", expect.objectContaining({ plainText: "x" }), ["ada", "grace"]);
  });

  it("does nothing further when storeDocument returns null (presence room)", async () => {
    m.storeDocument.mockResolvedValue(null);
    const { config } = await boot();
    await edit(config, "ada");
    await run(config, {});
    expect(m.maybeSnapshot).not.toHaveBeenCalled();
    expect(m.notifyCollabDocMentions).not.toHaveBeenCalled();
    expect(m.reconcilePageLinks).not.toHaveBeenCalled();
    await run(config, {});
    expect(m.maybeSnapshot).not.toHaveBeenCalled();
  });

  it("drains authors on a successful snapshot so the next one starts fresh", async () => {
    const { config } = await boot();
    await edit(config, "ada");
    await run(config, {});
    await run(config, {});
    expect(m.maybeSnapshot.mock.calls[1][2]).toEqual([]);
  });

  it("re-queues the authors when the snapshot was throttled", async () => {
    m.maybeSnapshot.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { config } = await boot();
    await edit(config, "ada");
    await run(config, {});
    await run(config, {});
    expect(m.maybeSnapshot.mock.calls[1][2]).toEqual(["ada"]);
  });

  it("re-queues the authors and does not throw when the snapshot errors", async () => {
    m.maybeSnapshot.mockRejectedValueOnce(new Error("lock timeout")).mockResolvedValue(true);
    const { config } = await boot();
    await edit(config, "ada");
    await expect(run(config, {})).resolves.toBeUndefined();
    await run(config, {});
    expect(m.maybeSnapshot.mock.calls[1][2]).toEqual(["ada"]);
  });

  it("does not fail the save when mention notification or link reconcile reject", async () => {
    m.notifyCollabDocMentions.mockRejectedValue(new Error("notify down"));
    m.reconcilePageLinks.mockRejectedValue(new Error("links down"));
    const { config } = await boot();
    await expect(run(config, {})).resolves.toBeUndefined();
    await flush();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("mention notify failed"), expect.any(Error));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("page-link reconcile failed"), expect.any(Error));
    expect(m.maybeSnapshot).toHaveBeenCalled();
  });

  it("propagates a storeDocument failure and keeps pending authors for the retry", async () => {
    m.storeDocument.mockRejectedValueOnce(new Error("db down"));
    const { config } = await boot();
    await edit(config, "ada");
    await expect(run(config, {})).rejects.toThrow("db down");
    await run(config, {});
    expect(m.maybeSnapshot.mock.calls[0][2]).toEqual(["ada"]);
  });
});

describe("onChange author tracking", () => {
  it("ignores changes with no authenticated user (e.g. server-side edits)", async () => {
    const { config } = await boot();
    await config.onChange({ documentName: "doc:p1:body", context: undefined });
    await config.onChange({ documentName: "doc:p1:body", context: { user: {} } });
    await config.onStoreDocument({ documentName: "doc:p1:body", document: {} });
    expect(m.maybeSnapshot.mock.calls[0][2]).toEqual([]);
  });

  it("tracks authors per document", async () => {
    const { config } = await boot();
    await config.onChange({ documentName: "doc:a:body", context: { user: { sub: "ada" } } });
    await config.onChange({ documentName: "doc:b:body", context: { user: { sub: "grace" } } });
    await config.onStoreDocument({ documentName: "doc:a:body", document: {} });
    expect(m.maybeSnapshot.mock.calls[0][2]).toEqual(["ada"]);
  });
});
