import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    pageView: { create: vi.fn(), updateMany: vi.fn() },
  },
}));

import { prisma } from "~/lib/db.server";
import {
  classifyClient,
  normalizePath,
  recordPageDuration,
  recordPageView,
  shouldTrackPath,
  MAX_DURATION_MS,
} from "~/lib/analytics";

const create = vi.mocked(prisma.pageView.create);
const updateMany = vi.mocked(prisma.pageView.updateMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shouldTrackPath", () => {
  it.each([
    "/",
    "/projects",
    "/projects/abc123",
    "/mentorship",
    "/attendance",
    "/documents/xyz",
    "/notifications",
    "/settings",
    "/rooms",
    "/whiteboard/abc",
    "/sign/token",
    "/signing",
    "/coffee-chats",
    "/partners",
    "/onboarding",
    "/help",
    "/blog/some-post",
    "/wallet",
    "/connect",
    "/users",
    "/admin/analytics",
    "/loginhelp",
    "/apiary",
    "/authors",
    "/mcpish-page",
  ])("tracks %s", (p) => {
    expect(shouldTrackPath(p)).toBe(true);
  });

  it.each([
    "/api/analytics/error",
    "/api/",
    "/auth/callback",
    "/oauth/authorize",
    "/.well-known/oauth-authorization-server",
    "/dev-login",
    "/dev-login/abc",
    "/login",
    "/logout",
    "/mcp",
    "/mcp/sse",
    "/public-api/offerings",
    "/assets/index-abc.js",
    "/build/client.js",
    "/internal/jobs/tick",
    "/favicon.ico",
    "/robots.txt",
    "/projects/logo.png",
    "/sitemap.xml",
  ])("skips %s", (p) => {
    expect(shouldTrackPath(p)).toBe(false);
  });
});

describe("normalizePath", () => {
  it("collapses cuids, uuids and numeric segments", () => {
    expect(normalizePath("/projects/cmabcdefghijklmnopqrstuvw/tasks/42")).toBe(
      "/projects/:id/tasks/:id",
    );
    expect(
      normalizePath("/forms/123e4567-e89b-12d3-a456-426614174000/edit"),
    ).toBe("/forms/:id/edit");
  });

  it("leaves readable slugs and the root alone", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("/blog/my-post")).toBe("/blog/my-post");
    expect(normalizePath("/projects/")).toBe("/projects/");
  });
});

describe("classifyClient", () => {
  it("classifies the desktop shell", () => {
    expect(
      classifyClient("Mozilla/5.0 (Macintosh) AppleWebKit DALI OS Desktop/1.2"),
    ).toBe("desktop");
  });

  it("prefers desktop over mobile tokens", () => {
    expect(classifyClient("Android DALI OS Desktop")).toBe("desktop");
  });

  it.each([
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari",
    "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome Mobile",
    "Mozilla/5.0 Mobile Safari",
  ])("classifies %s as mobile", (ua) => {
    expect(classifyClient(ua)).toBe("mobile");
  });

  it("falls back to web", () => {
    expect(
      classifyClient("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120"),
    ).toBe("web");
    expect(classifyClient(null)).toBe("web");
    expect(classifyClient("")).toBe("web");
  });
});

describe("recordPageView", () => {
  const base = {
    id: "id-1",
    userId: "u1",
    sessionId: "s1",
    userAgent: "Mozilla/5.0 (iPhone)",
  };

  it("writes a normalized row with the client class", async () => {
    await recordPageView({
      ...base,
      path: "/projects/cmabcdefghijklmnopqrstuvw",
      referrer: "/hiring",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        id: "id-1",
        userId: "u1",
        sessionId: "s1",
        path: "/projects/:id",
        referrer: "/hiring",
        client: "mobile",
      },
    });
  });

  it("stores a null referrer when none is given", async () => {
    await recordPageView({ ...base, path: "/help" });
    expect(create.mock.calls[0][0].data.referrer).toBeNull();
  });

  it("skips untracked paths", async () => {
    await recordPageView({ ...base, path: "/api/x" });
    expect(create).not.toHaveBeenCalled();
  });

  it("ignores a duplicate id silently", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(recordPageView({ ...base, path: "/help" })).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs but swallows other write errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error("boom"));
    await expect(recordPageView({ ...base, path: "/help" })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("recordPageDuration", () => {
  it("scopes the update to the user and overwrites the duration", async () => {
    await recordPageDuration({ id: "id-1", userId: "u1", durationMs: 4_200 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "id-1", userId: "u1" },
      data: { durationMs: 4_200 },
    });
  });

  it("clamps to [0, 30 min]", async () => {
    await recordPageDuration({ id: "a", userId: "u1", durationMs: 99_999_999 });
    expect(updateMany.mock.calls[0][0].data).toEqual({
      durationMs: MAX_DURATION_MS,
    });
    await recordPageDuration({ id: "a", userId: "u1", durationMs: -5 });
    expect(updateMany.mock.calls[1][0].data).toEqual({ durationMs: 0 });
  });

  it("swallows write errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    updateMany.mockRejectedValueOnce(new Error("boom"));
    await expect(
      recordPageDuration({ id: "a", userId: "u1", durationMs: 1 }),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
