import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db");
vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));
vi.mock("~/signing/lib/notify.server", () => ({ notifySignRequest: vi.fn() }));

import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { notifySignRequest } from "~/signing/lib/notify.server";
import { runSigningIssuance } from "~/jobs/signing-issuance.server";

const mockPrisma = prisma as unknown as Record<
  string,
  Record<string, ReturnType<typeof vi.fn>>
>;
const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;
const mockNotify = notifySignRequest as unknown as ReturnType<typeof vi.fn>;

const NOW = new Date("2026-09-15T12:00:00Z");
const CTX = { now: NOW, lastSuccessAt: null, settings: {} };

beforeEach(() => {
  vi.resetAllMocks();
  mockCurrentTerm.mockResolvedValue({ id: "term-26f", code: "26F" });
});

describe("runSigningIssuance", () => {
  it("materializes the current term's binding for an already-activated PerTerm doc and notifies", async () => {
    mockPrisma.signingDocument.findMany.mockResolvedValue([
      { id: "doc1", bindings: [{ versionId: "v1" }] },
    ]);
    mockPrisma.signingBinding.findUnique.mockResolvedValue(null); // not yet issued this term
    mockPrisma.signingBinding.create.mockResolvedValue({ id: "b-new" });

    const result = await runSigningIssuance(CTX);

    // Only recurring, opted-in (≥1 binding), non-archived docs are considered.
    expect(mockPrisma.signingDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cadence: "PerTerm", archivedAt: null, bindings: { some: {} } },
      }),
    );
    // Carries the last-enforced version forward into the new term's scope.
    expect(mockPrisma.signingBinding.create).toHaveBeenCalledWith({
      data: { documentId: "doc1", versionId: "v1", scopeKey: "term:term-26f", termId: "term-26f" },
      select: { id: true },
    });
    expect(mockNotify).toHaveBeenCalledWith("b-new");
    expect(result.items).toBe(1);
  });

  it("is idempotent — a re-tick with the term's binding present creates nothing and does not notify", async () => {
    mockPrisma.signingDocument.findMany.mockResolvedValue([
      { id: "doc1", bindings: [{ versionId: "v1" }] },
    ]);
    mockPrisma.signingBinding.findUnique.mockResolvedValue({ id: "b-existing" });

    const result = await runSigningIssuance(CTX);

    expect(mockPrisma.signingBinding.create).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
    expect(result.items).toBe(0);
  });

  it("no-ops when there is no current term", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    const result = await runSigningIssuance(CTX);
    expect(result.note).toBe("no current term");
    expect(mockPrisma.signingDocument.findMany).not.toHaveBeenCalled();
  });
});
