import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  readFormsPendingResource,
  FORMS_PENDING_RESOURCE,
} from "~/mcp/resources/forms-pending";

const mockPrisma = prisma as unknown as {
  notification: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.notification.count = vi.fn().mockResolvedValue(0);
});

describe("dali://forms/pending", () => {
  it("requires the mcp:read scope", () => {
    expect(FORMS_PENDING_RESOURCE.requiredScope).toBe("mcp:read");
  });

  it("emits JSON with fill URLs for pending forms", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([
      {
        id: "n1",
        title: "Project bids: 26S",
        body: "Submit by Friday",
        dueAt: new Date("2026-06-05T22:00:00Z"),
        createdAt: new Date("2026-06-01T15:00:00Z"),
        formId: "f1",
        form: { name: "Project Bids", publicToken: "tok-1" },
      },
    ]);
    mockPrisma.notification.count.mockResolvedValue(1);
    const text = await readFormsPendingResource("u1");
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ total: 1, truncated: false });
    expect(parsed.pendingForms).toEqual([
      {
        notificationId: "n1",
        title: "Project bids: 26S",
        body: "Submit by Friday",
        dueAt: "2026-06-05T22:00:00.000Z",
        formId: "f1",
        formName: "Project Bids",
        fillUrl: "/forms/fill/tok-1",
        postedAt: "2026-06-01T15:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when none are pending", async () => {
    mockPrisma.notification.findMany.mockResolvedValue([]);
    const text = await readFormsPendingResource("u1");
    expect(JSON.parse(text)).toEqual({ pendingForms: [], total: 0, truncated: false });
  });

  it("signals truncation with the real total when more than 50 are pending", async () => {
    mockPrisma.notification.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => ({
        id: `n${i}`,
        title: "T",
        body: null,
        dueAt: null,
        createdAt: new Date("2026-06-01T15:00:00Z"),
        formId: `f${i}`,
        form: { name: "F", publicToken: `tok-${i}` },
      })),
    );
    mockPrisma.notification.count.mockResolvedValue(64);
    const parsed = JSON.parse(await readFormsPendingResource("u1"));
    expect(parsed.pendingForms).toHaveLength(50);
    expect(parsed).toMatchObject({ total: 64, truncated: true });
  });
});
