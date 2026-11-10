import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ visibleHelpArticles: vi.fn(), findHelpArticle: vi.fn(), getUserRoles: vi.fn() }));
vi.mock("~/lib/db.server");
vi.mock("~/lib/roles", () => ({ getUserRoles: h.getUserRoles }));
vi.mock("~/help/library.server", () => ({ visibleHelpArticles: h.visibleHelpArticles, findHelpArticle: h.findHelpArticle }));

import { READ_HELP_TOOL, runReadHelp } from "../read-help";
import { McpNotFoundError } from "~/mcp/errors";
import { findRegistryTool } from "~/mcp/registry";

const request = new Request("http://x/mcp");
const ctx = { user: { id: "u1" }, request } as Parameters<typeof runReadHelp>[0];
const ROLES = { isLabMember: true };
const ARTICLE = {
  slug: "rooms",
  title: "Booking rooms",
  summary: "Find and book a room.",
  url: "/help/articles/rooms",
  body: "## Book a room",
  audience: [],
  flag: null,
  paths: [],
  keywords: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.getUserRoles.mockResolvedValue(ROLES);
});

describe("read_help", () => {
  it("is a registered read tool", () => {
    expect(READ_HELP_TOOL.requiredScope).toBe("mcp:read");
    expect(findRegistryTool("read_help")?.def).toBe(READ_HELP_TOOL);
  });

  it("lists the articles the caller can see, without their bodies", async () => {
    h.visibleHelpArticles.mockResolvedValue([ARTICLE]);
    expect(await runReadHelp(ctx, {})).toEqual({
      articles: [{ slug: "rooms", title: "Booking rooms", summary: "Find and book a room." }],
    });
    expect(h.visibleHelpArticles).toHaveBeenCalledWith({ userId: "u1", roles: ROLES, request });
  });

  it("reads one article by slug", async () => {
    h.findHelpArticle.mockResolvedValue(ARTICLE);
    expect(await runReadHelp(ctx, { slug: "rooms" })).toEqual({
      slug: "rooms",
      title: "Booking rooms",
      url: "/help/articles/rooms",
      body: "## Book a room",
    });
    expect(h.findHelpArticle).toHaveBeenCalledWith({ userId: "u1", roles: ROLES, request }, "rooms");
  });

  it("treats an article the caller can't see like one that doesn't exist", async () => {
    h.findHelpArticle.mockResolvedValue(null);
    await expect(runReadHelp(ctx, { slug: "running-staffing" })).rejects.toBeInstanceOf(McpNotFoundError);
  });
});
