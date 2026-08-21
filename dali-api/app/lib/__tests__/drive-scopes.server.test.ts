import { describe, it, expect, vi } from "vitest";

// Mock the prisma client so importing the *.server module (and its transitive
// imports) never instantiates a real DB client. liftRootChildren is pure.
vi.mock("~/lib/db", () => ({ prisma: {} }));

import { liftRootChildren } from "~/lib/drive-scopes.server";
import type { DriveItem } from "~/lib/drive.server";

const form = (id: string, parentFolderId: string | null): DriveItem => ({
  type: "form",
  id,
  title: id,
  parentFolderId,
  iconEmoji: null,
  updatedAt: new Date(0),
  href: `/forms/edit/${id}`,
});

describe("liftRootChildren", () => {
  it("reparents items filed directly at the root to null so they render at the scope top", () => {
    const items = [form("a", "root"), form("b", "sub"), form("c", null)];
    const out = liftRootChildren(items, "root");
    // Filed at the root → lifted to top level (the reason Core-filed forms were
    // invisible before this fix).
    expect(out.find((i) => i.id === "a")?.parentFolderId).toBeNull();
    // Nested under a real subfolder → untouched.
    expect(out.find((i) => i.id === "b")?.parentFolderId).toBe("sub");
    // Already top-level → stays null.
    expect(out.find((i) => i.id === "c")?.parentFolderId).toBeNull();
  });

  it("is a no-op (same array) when no scoped root is provisioned", () => {
    const items = [form("a", "root")];
    expect(liftRootChildren(items, undefined)).toBe(items);
    expect(liftRootChildren(items, null)).toBe(items);
  });
});
