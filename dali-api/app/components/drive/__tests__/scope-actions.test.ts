import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/notebooks/notebook-requests", () => ({ notebookRequest: vi.fn(), sendJson: vi.fn() }));

import type { DriveItem } from "~/drive/lib/drive.server";
import { resolveWorkspaceId, scopeKindOf } from "../scope-actions";

const node = (id: string, parentFolderId: string | null) => ({ id, parentFolderId }) as DriveItem;

describe("scopeKindOf", () => {
  it("names the fixed scopes", () => {
    expect(scopeKindOf("mine")).toBe("mine");
    expect(scopeKindOf("lab")).toBe("lab");
    expect(scopeKindOf("projects")).toBe("projects-group");
    expect(scopeKindOf("education")).toBe("education-group");
  });

  it("treats any other id as a project drive", () => {
    expect(scopeKindOf("proj-123")).toBe("project");
  });
});

describe("resolveWorkspaceId", () => {
  const items = [node("ws", null), node("a", "ws"), node("b", "a")];

  it("returns null with no folder", () => {
    expect(resolveWorkspaceId(items, null)).toBeNull();
  });

  it("walks up to the top-level node", () => {
    expect(resolveWorkspaceId(items, "b")).toBe("ws");
    expect(resolveWorkspaceId(items, "ws")).toBe("ws");
  });

  it("returns null for an unknown folder and survives a cycle", () => {
    expect(resolveWorkspaceId(items, "missing")).toBeNull();
    expect(resolveWorkspaceId([node("x", "y"), node("y", "x")], "x")).toBeNull();
  });
});
