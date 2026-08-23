import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", () => ({ currentTerm: vi.fn() }));

import { currentTerm } from "~/lib/roles";
import { resolveAdminScope } from "~/signing/lib/scope.server";

const mockCurrentTerm = currentTerm as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("resolveAdminScope", () => {
  it("Once → a single standing app-scoped binding", async () => {
    const scope = await resolveAdminScope({ cadence: "Once" } as never);
    expect(scope).toEqual({ scopeKey: "app" });
    expect(mockCurrentTerm).not.toHaveBeenCalled();
  });

  it("PerTerm → the current term's scope", async () => {
    mockCurrentTerm.mockResolvedValue({ id: "term-26f", code: "26F" });
    const scope = await resolveAdminScope({ cadence: "PerTerm" } as never);
    expect(scope).toEqual({ scopeKey: "term:term-26f", termId: "term-26f" });
  });

  it("PerTerm with an explicit termId → that term's scope, ignoring the current term", async () => {
    mockCurrentTerm.mockResolvedValue({ id: "term-26x", code: "26X" });
    const scope = await resolveAdminScope({ cadence: "PerTerm" } as never, {
      termId: "term-26f",
    });
    expect(scope).toEqual({ scopeKey: "term:term-26f", termId: "term-26f" });
    // The selected term wins outright — no need to consult the current term.
    expect(mockCurrentTerm).not.toHaveBeenCalled();
  });

  it("PerTerm with no current term → an error", async () => {
    mockCurrentTerm.mockResolvedValue(null);
    const scope = await resolveAdminScope({ cadence: "PerTerm" } as never);
    expect(scope).toHaveProperty("error");
  });

  it("PerCycle → an error (bound from the hiring cycle UI, not here)", async () => {
    const scope = await resolveAdminScope({ cadence: "PerCycle" } as never);
    expect(scope).toHaveProperty("error");
  });
});
