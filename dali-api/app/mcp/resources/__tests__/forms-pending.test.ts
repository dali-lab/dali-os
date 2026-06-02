import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");

import { prisma } from "~/lib/db";
import {
  readFormsPendingResource,
  FORMS_PENDING_RESOURCE,
} from "~/mcp/resources/forms-pending";

const mockPrisma = prisma as unknown as {
  notification: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
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
    const text = await readFormsPendingResource("u1");
    const parsed = JSON.parse(text);
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
    expect(JSON.parse(text)).toEqual({ pendingForms: [] });
  });
});
