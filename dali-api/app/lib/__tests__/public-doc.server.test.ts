import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db", () => ({
  prisma: { page: { findUnique: vi.fn() } },
}));

import { prisma } from "~/lib/db";
import { isPublicDoc, publicDocRedirectForPath } from "~/lib/public-doc.server";

const findUnique = vi.mocked(prisma.page.findUnique);

describe("publicDocRedirectForPath", () => {
  beforeEach(() => findUnique.mockReset());

  it("sends a public doc's canonical URL to its read-only view", async () => {
    findUnique.mockResolvedValue({ linkAccess: "Public", archivedAt: null } as never);
    const res = await publicDocRedirectForPath("/documents/abc");
    expect(res?.status).toBe(302);
    expect(res?.headers.get("Location")).toBe("/documents/abc/public");
  });

  it("falls through for restricted, lab-only, archived, or missing docs", async () => {
    findUnique.mockResolvedValue({ linkAccess: "LabMembers", archivedAt: null } as never);
    expect(await publicDocRedirectForPath("/documents/abc")).toBeNull();
    findUnique.mockResolvedValue({ linkAccess: "Public", archivedAt: new Date() } as never);
    expect(await publicDocRedirectForPath("/documents/abc")).toBeNull();
    findUnique.mockResolvedValue(null);
    expect(await publicDocRedirectForPath("/documents/abc")).toBeNull();
  });

  it("ignores every other path without touching the database", async () => {
    expect(await publicDocRedirectForPath("/documents/abc/public")).toBeNull();
    expect(await publicDocRedirectForPath("/drive")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("isPublicDoc requires Public and not archived", () => {
    expect(isPublicDoc({ linkAccess: "Public", archivedAt: null })).toBe(true);
    expect(isPublicDoc({ linkAccess: "Restricted", archivedAt: null })).toBe(false);
    expect(isPublicDoc({ linkAccess: "Public", archivedAt: new Date() })).toBe(false);
  });
});
