import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");

import { prisma } from "~/lib/db.server";
import {
  loadPartnerActivityPage,
  PARTNER_ACTIVITY_PAGE_SIZE,
} from "~/partners/lib/partner-activity-page.server";

const db = prisma as unknown as {
  partnerActivity: { findMany: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
};

function row(n: number, actorUserId: string | null = null) {
  return {
    id: `a${String(n).padStart(3, "0")}`,
    createdAt: new Date(Date.UTC(2026, 9, 1, 12, 0, 0) - n * 1000),
    applicationId: null,
    actorUserId,
    type: "Note",
    body: `Note ${n}`,
    metadata: null,
  };
}

describe("loadPartnerActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.partnerActivity.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);
  });

  it("scopes by org and sorts newest first with an id tiebreak", async () => {
    await loadPartnerActivityPage({ orgId: "o1" });
    const args = db.partnerActivity.findMany.mock.calls[0][0];
    expect(args.where.AND[0]).toEqual({ orgId: "o1" });
    expect(args.where.AND[1]).toEqual({});
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(PARTNER_ACTIVITY_PAGE_SIZE + 1);
  });

  it("scopes by contact", async () => {
    await loadPartnerActivityPage({ contactId: "c1" });
    expect(db.partnerActivity.findMany.mock.calls[0][0].where.AND[0]).toEqual({ contactId: "c1" });
  });

  it("applies the cursor as a keyset condition", async () => {
    await loadPartnerActivityPage({ orgId: "o1" }, "2026-10-01T12:00:00.000Z|a010");
    const at = new Date("2026-10-01T12:00:00.000Z");
    expect(db.partnerActivity.findMany.mock.calls[0][0].where.AND[1]).toEqual({
      OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "a010" } }],
    });
  });

  it("returns a short page with no cursor and serialises dates", async () => {
    db.partnerActivity.findMany.mockResolvedValue([row(1), row(2)]);
    const page = await loadPartnerActivityPage({ orgId: "o1" });
    expect(page.items.map((i) => i.id)).toEqual(["a001", "a002"]);
    expect(page.items[0].createdAt).toBe(row(1).createdAt.toISOString());
    expect(page.nextCursor).toBeNull();
  });

  it("trims to a page and sets a cursor at the last kept row", async () => {
    db.partnerActivity.findMany.mockResolvedValue(
      Array.from({ length: PARTNER_ACTIVITY_PAGE_SIZE + 1 }, (_, i) => row(i + 1)),
    );
    const page = await loadPartnerActivityPage({ orgId: "o1" });
    expect(page.items).toHaveLength(PARTNER_ACTIVITY_PAGE_SIZE);
    const last = row(PARTNER_ACTIVITY_PAGE_SIZE);
    expect(page.nextCursor).toBe(`${last.createdAt.toISOString()}|${last.id}`);
  });

  it("resolves actor names only for rows on the page", async () => {
    db.partnerActivity.findMany.mockResolvedValue([row(1, "u1"), row(2, "u1"), row(3, null)]);
    db.user.findMany.mockResolvedValue([
      { id: "u1", firstName: "Ada", lastName: "Lovelace", daliEmail: "ada@example.edu" },
    ]);
    const page = await loadPartnerActivityPage({ orgId: "o1" });
    expect(db.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ["u1"] } });
    expect(page.actorNames).toEqual({ u1: "Ada Lovelace" });
  });

  it("falls back to the email when a user has no name", async () => {
    db.partnerActivity.findMany.mockResolvedValue([row(1, "u2")]);
    db.user.findMany.mockResolvedValue([
      { id: "u2", firstName: null, lastName: null, daliEmail: "ada@example.edu" },
    ]);
    expect((await loadPartnerActivityPage({ orgId: "o1" })).actorNames).toEqual({ u2: "ada@example.edu" });
  });

  it("skips the user query when no row has an actor", async () => {
    db.partnerActivity.findMany.mockResolvedValue([row(1)]);
    await loadPartnerActivityPage({ orgId: "o1" });
    expect(db.user.findMany).not.toHaveBeenCalled();
  });
});
