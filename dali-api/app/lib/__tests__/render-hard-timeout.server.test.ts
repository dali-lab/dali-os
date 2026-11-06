import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pw = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock("playwright-core", () => ({ chromium: { launch: pw.launch } }));

type Render = typeof import("~/lib/pdf/render.server");
let renderHtmlToPdf: Render["renderHtmlToPdf"];
let renderHtmlToPng: Render["renderHtmlToPng"];
let RenderTimeoutError: Render["RenderTimeoutError"];
let withHardDeadline: Render["withHardDeadline"];

interface Fake {
  log: string[];
  browser: { isConnected: () => boolean; newContext: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  context: { route: ReturnType<typeof vi.fn>; newPage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
}

function fake(behaviour: { pdf?: () => Promise<unknown>; screenshot?: () => Promise<unknown> } = {}): Fake {
  const log: string[] = [];
  const page = {
    setContent: vi.fn(async () => void log.push("setContent")),
    evaluate: vi.fn(async () => undefined),
    $$: vi.fn(async () => []),
    waitForTimeout: vi.fn(async () => {}),
    pdf: vi.fn(behaviour.pdf ?? (async () => Buffer.from("%PDF"))),
    screenshot: vi.fn(behaviour.screenshot ?? (async () => Buffer.from("png"))),
  };
  const context = {
    route: vi.fn(async () => void log.push("route")),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => void log.push("context.close")),
  };
  const browser = { isConnected: () => true, newContext: vi.fn(async () => context), close: vi.fn(async () => void log.push("browser.close")) };
  return { log, browser, context };
}

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ renderHtmlToPdf, renderHtmlToPng, RenderTimeoutError, withHardDeadline } = await import("~/lib/pdf/render.server"));
});

describe("renderHtmlToPdf", () => {
  it("renders as before when no guard, deadline or frame options are given", async () => {
    const f = fake();
    pw.launch.mockResolvedValue(f.browser);
    const pdf = await renderHtmlToPdf("<p>x</p>");
    expect(pdf.toString()).toBe("%PDF");
    expect(f.browser.newContext).toHaveBeenCalledWith({});
    expect(f.context.route).not.toHaveBeenCalled();
    expect(f.log).toEqual(["setContent", "context.close"]);
  });

  it("installs the network guard before any content is set", async () => {
    const f = fake();
    pw.launch.mockResolvedValue(f.browser);
    await renderHtmlToPdf("<p>x</p>", { guardNetwork: true, settleHtmlFrames: true, hardTimeoutMs: 1000 });
    expect(f.log.slice(0, 2)).toEqual(["route", "setContent"]);
    expect(f.context.route).toHaveBeenCalledWith("**/*", expect.any(Function));
  });

  it("turns scripts off when asked", async () => {
    const f = fake();
    pw.launch.mockResolvedValue(f.browser);
    await renderHtmlToPdf("<p>x</p>", { javaScriptEnabled: false });
    expect(f.browser.newContext).toHaveBeenCalledWith({ javaScriptEnabled: false });
  });

  it("kills the render on a hung page, throws, and starts a fresh browser for the next one", async () => {
    const hung = fake({ pdf: () => new Promise(() => {}) });
    const fresh = fake();
    pw.launch.mockResolvedValueOnce(hung.browser).mockResolvedValueOnce(fresh.browser);
    await expect(renderHtmlToPdf("<p>x</p>", { hardTimeoutMs: 30 })).rejects.toBeInstanceOf(RenderTimeoutError);
    expect(hung.context.close).toHaveBeenCalled();
    expect(hung.browser.close).toHaveBeenCalled();
    expect(hung.log.indexOf("context.close")).toBeLessThan(hung.log.indexOf("browser.close"));
    const pdf = await renderHtmlToPdf("<p>y</p>");
    expect(pdf.toString()).toBe("%PDF");
    expect(pw.launch).toHaveBeenCalledTimes(2);
    expect(fresh.browser.close).not.toHaveBeenCalled();
  });

  it("does not wait forever on a context that will not close", async () => {
    const hung = fake({ pdf: () => new Promise(() => {}) });
    hung.context.close.mockImplementation(() => new Promise(() => {}));
    pw.launch.mockResolvedValue(hung.browser);
    vi.useFakeTimers();
    const run = renderHtmlToPdf("<p>x</p>", { hardTimeoutMs: 30 });
    const caught = run.catch((e) => e);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await caught).toBeInstanceOf(RenderTimeoutError);
    expect(hung.browser.close).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("renderHtmlToPng", () => {
  it("returns a data picture for a normal render, with the guard installed first", async () => {
    const f = fake();
    pw.launch.mockResolvedValue(f.browser);
    expect(await renderHtmlToPng("<p>x</p>", { w: 100, h: 50 })).toBe(`image/png;base64,${Buffer.from("png").toString("base64")}`);
    expect(f.log.slice(0, 2)).toEqual(["route", "setContent"]);
  });

  it("returns null and kills the renderer when the page hangs", async () => {
    const f = fake({ screenshot: () => new Promise(() => {}) });
    pw.launch.mockResolvedValue(f.browser);
    expect(await renderHtmlToPng("<p>x</p>", { w: 100, h: 50 }, { hardTimeoutMs: 30 })).toBeNull();
    expect(f.context.close).toHaveBeenCalled();
    expect(f.browser.close).toHaveBeenCalled();
  });
});

describe("withHardDeadline", () => {
  it("returns the result and does not kill when the work finishes in time", async () => {
    const kill = vi.fn(async () => {});
    expect(await withHardDeadline(1000, async () => 7, kill)).toBe(7);
    expect(kill).not.toHaveBeenCalled();
  });

  it("does not kill on an ordinary failure", async () => {
    const kill = vi.fn(async () => {});
    await expect(withHardDeadline(1000, async () => Promise.reject(new Error("bad")), kill)).rejects.toThrow("bad");
    expect(kill).not.toHaveBeenCalled();
  });
});
