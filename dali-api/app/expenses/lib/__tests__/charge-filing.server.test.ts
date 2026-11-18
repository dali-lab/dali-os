import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.hoisted(() => vi.fn());
vi.mock("~/lib/db.server", () => ({ prisma: { cardStatementCharge: { findUnique } } }));

import { getChargeForFiling } from "../charge-filing.server";

const viewer = { userId: "u1", isCore: false, isStaff: false, ownedCardIds: [] as string[] };
const charge = (over: Record<string, unknown> = {}) => ({
  id: "ch1",
  cardId: "k1",
  merchant: "GNOMON COPY",
  amount: { toString: () => "36.87" },
  postedAt: new Date("2026-11-17T00:00:00Z"),
  expense: null,
  card: { id: "k1", nickname: "Programs Visa", last4: "4821", ownerId: "owner", holderIds: ["u1"], holderGroupIds: [], archivedAt: null },
  ...over,
});

beforeEach(() => vi.resetAllMocks());

describe("getChargeForFiling", () => {
  it("returns the charge for a card holder", async () => {
    findUnique.mockResolvedValue(charge());
    expect(await getChargeForFiling(viewer, "ch1")).toEqual({
      id: "ch1", cardId: "k1", cardNickname: "Programs Visa", cardLast4: "4821", merchant: "GNOMON COPY", postedAt: "2026-11-17", amountCents: 3687,
    });
  });
  it("returns it for the card owner", async () => {
    findUnique.mockResolvedValue(charge());
    await expect(getChargeForFiling({ ...viewer, userId: "owner" }, "ch1")).resolves.toMatchObject({ id: "ch1" });
  });
  it("hides it from someone who can't file on the card", async () => {
    findUnique.mockResolvedValue(charge());
    await expect(getChargeForFiling({ ...viewer, userId: "stranger" }, "ch1")).rejects.toMatchObject({ code: "not_found" });
  });
  it("hides it from Core who isn't a holder", async () => {
    findUnique.mockResolvedValue(charge());
    await expect(getChargeForFiling({ ...viewer, userId: "c", isCore: true }, "ch1")).rejects.toMatchObject({ code: "not_found" });
  });
  it("hides it on an archived card", async () => {
    findUnique.mockResolvedValue(charge({ card: { ...charge().card, archivedAt: new Date() } }));
    await expect(getChargeForFiling(viewer, "ch1")).rejects.toMatchObject({ code: "not_found" });
  });
  it("is not found when missing, already filed, or a refund", async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(getChargeForFiling(viewer, "nope")).rejects.toMatchObject({ code: "not_found" });
    findUnique.mockResolvedValueOnce(charge({ expense: { id: "e1" } }));
    await expect(getChargeForFiling(viewer, "ch1")).rejects.toMatchObject({ code: "not_found" });
    findUnique.mockResolvedValueOnce(charge({ amount: { toString: () => "-5.00" } }));
    await expect(getChargeForFiling(viewer, "ch1")).rejects.toMatchObject({ code: "not_found" });
  });
});
