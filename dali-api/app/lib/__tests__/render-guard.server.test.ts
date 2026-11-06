import { describe, expect, it, vi } from "vitest";
import { createRequestGuard, guardContext, isPrivateAddress, type RoutableContext } from "~/lib/pdf/render-guard.server";

const guard = (map: Record<string, string[]> = {}) => {
  const resolve = vi.fn(async (host: string) => {
    if (!(host in map)) throw new Error("ENOTFOUND");
    return map[host];
  });
  return { resolve, g: createRequestGuard(resolve) };
};

describe("isPrivateAddress", () => {
  it.each(["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "ff02::1", "not an ip"])("%s is not public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe("request guard", () => {
  it("allows inline data and the script and font CDNs without a lookup", async () => {
    const { g, resolve } = guard();
    for (const url of [
      "data:image/png;base64,AA",
      "blob:https://x/1",
      "about:blank",
      "https://cdnjs.cloudflare.com/ajax/libs/x.js",
      "https://cdn.jsdelivr.net/npm/x",
      "https://unpkg.com/x",
      "https://fonts.googleapis.com/css2?family=Mulish",
      "https://fonts.gstatic.com/s/mulish.woff2",
    ]) {
      expect(await g.allow(url, "script")).toBe(true);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("allows an image on a host that resolves to public addresses, once per host", async () => {
    const { g, resolve } = guard({ "images.example.org": ["93.184.216.34"] });
    expect(await g.allow("https://images.example.org/a.png", "image")).toBe(true);
    expect(await g.allow("https://images.example.org/b.png", "image")).toBe(true);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("blocks http, localhost, internal names and private IP literals", async () => {
    const { g, resolve } = guard();
    for (const url of [
      "http://images.example.org/a.png",
      "https://localhost/a.png",
      "https://LOCALHOST./a.png",
      "https://db.internal/a.png",
      "https://app.flycast/a.png",
      "https://printer.local/a.png",
      "https://10.0.0.5/a.png",
      "https://127.0.0.1/a.png",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/a.png",
      "https://[fd00::1]/a.png",
      "ftp://example.org/a",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(await g.allow(url, "image")).toBe(false);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private address, even among public ones", async () => {
    const { g } = guard({ "evil.example.org": ["10.0.0.7"], "mixed.example.org": ["93.184.216.34", "192.168.0.2"], "v6.example.org": ["::ffff:127.0.0.1"] });
    expect(await g.allow("https://evil.example.org/a.png", "image")).toBe(false);
    expect(await g.allow("https://mixed.example.org/a.png", "image")).toBe(false);
    expect(await g.allow("https://v6.example.org/a.png", "image")).toBe(false);
  });

  it("blocks a host that does not resolve", async () => {
    expect((await guard().g.allow("https://nowhere.example.org/a.png", "image"))).toBe(false);
  });

  it("only lets other public hosts serve images and media, never scripts, styles or frames", async () => {
    const { g } = guard({ "images.example.org": ["93.184.216.34"] });
    for (const type of ["script", "stylesheet", "font", "fetch", "xhr", "document", "websocket"]) {
      expect(await g.allow("https://images.example.org/x", type)).toBe(false);
    }
    expect(await g.allow("https://images.example.org/x", "media")).toBe(true);
  });
});

describe("guardContext", () => {
  it("continues allowed requests, aborts the rest, and aborts when the guard throws", async () => {
    let handler!: Parameters<RoutableContext["route"]>[1];
    const context: RoutableContext = { route: vi.fn(async (_p, h) => void (handler = h)) };
    await guardContext(context, {
      allow: async (url) => {
        if (url === "boom") throw new Error("x");
        return url.startsWith("data:");
      },
    });
    expect(context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
    const run = async (url: string) => {
      const route = { request: () => ({ url: () => url, resourceType: () => "image" }), continue: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
      await handler(route);
      return route;
    };
    const ok = await run("data:x");
    expect(ok.continue).toHaveBeenCalled();
    expect(ok.abort).not.toHaveBeenCalled();
    const no = await run("https://a/b");
    expect(no.abort).toHaveBeenCalledWith("blockedbyclient");
    expect((await run("boom")).abort).toHaveBeenCalled();
  });
});
