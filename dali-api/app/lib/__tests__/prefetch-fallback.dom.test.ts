// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPrefetchFallback } from "../prefetch-fallback";
import { isPrefetchRequest } from "../prefetch";

const data = (body = "warm", init: ResponseInit = {}) => new Response(body, init);

function addLink(href: string, attrs: Record<string, string> = { rel: "prefetch", as: "fetch" }) {
  const link = document.createElement("link");
  for (const [k, v] of Object.entries(attrs)) link.setAttribute(k, v);
  link.setAttribute("href", href);
  document.body.appendChild(link);
  return link;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("installPrefetchFallback", () => {
  const originalFetch = window.fetch;
  let network: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    network = vi.fn(async () => data());
    window.fetch = network as unknown as typeof fetch;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("leaves fetch alone where rel=prefetch works", () => {
    installPrefetchFallback(window, true);
    expect(window.fetch).toBe(network);
  });

  it("fetches a data prefetch link when it is added", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("finds a link nested in an added subtree", async () => {
    installPrefetchFallback(window, false);
    const wrap = document.createElement("div");
    wrap.innerHTML = '<link rel="prefetch" as="fetch" href="/nested.data">';
    document.body.appendChild(wrap);
    await flush();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("ignores other links and off-origin data urls", async () => {
    installPrefetchFallback(window, false);
    addLink("/a.js", { rel: "modulepreload" });
    addLink("/a.css", { rel: "prefetch", as: "style" });
    addLink("https://other.example/x.data");
    await flush();
    expect(network).not.toHaveBeenCalled();
  });

  it("does not fetch the same url twice while it is fresh", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    addLink("/projects.data");
    await flush();
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("serves the warmed response to the next navigation only", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    const first = await window.fetch(new URL("/projects.data", location.href));
    expect(await first.text()).toBe("warm");
    expect(network).toHaveBeenCalledTimes(1);
    await window.fetch(new URL("/projects.data", location.href));
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("waits for a warm still in flight instead of fetching again", async () => {
    let release = (_: Response) => {};
    network.mockImplementationOnce(() => new Promise((r) => (release = r)));
    installPrefetchFallback(window, false);
    addLink("/slow.data");
    await flush();
    const nav = window.fetch("/slow.data");
    release(data("late"));
    expect(await (await nav).text()).toBe("late");
    expect(network).toHaveBeenCalledTimes(1);
  });

  it("matches on the exact query string", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data?tab=a");
    await flush();
    await window.fetch("/projects.data?tab=b");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("goes to the network once a warm is past the reuse window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
    await window.fetch("/projects.data");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("drops every warm on a data mutation", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    await window.fetch("/tasks.data", { method: "POST" });
    await window.fetch("/projects.data");
    expect(network).toHaveBeenCalledTimes(3);
  });

  it("refetches when the warm failed", async () => {
    network.mockRejectedValueOnce(new Error("offline"));
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    const res = await window.fetch("/projects.data");
    expect(await res.text()).toBe("warm");
    expect(network).toHaveBeenCalledTimes(2);
  });

  it("refetches when the warm returned an error status", async () => {
    network.mockResolvedValueOnce(data("nope", { status: 500 }));
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    const res = await window.fetch("/projects.data");
    expect(await res.text()).toBe("warm");
  });

  it("marks a warm as a prefetch so the loader doesn't count it as a page open", async () => {
    installPrefetchFallback(window, false);
    addLink("/projects.data");
    await flush();
    const [href, init] = network.mock.calls[0] as [string, RequestInit];
    const request = new Request(new URL(href, "http://localhost"), init);
    expect(isPrefetchRequest(request)).toBe(true);
  });

  it("passes non-data requests straight through", async () => {
    installPrefetchFallback(window, false);
    await window.fetch("/api/notifications", { method: "POST" });
    expect(network).toHaveBeenCalledWith("/api/notifications", { method: "POST" });
  });
});
