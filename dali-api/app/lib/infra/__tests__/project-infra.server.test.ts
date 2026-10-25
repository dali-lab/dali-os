import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/db", () => ({ prisma: {} }));

import { buildInfraConfigUpdate } from "../project-infra.server";

describe("buildInfraConfigUpdate neonProjectIds", () => {
  it("leaves linked databases unchanged when not submitted", () => {
    expect(buildInfraConfigUpdate({ neonOrgId: "org-dali-1" })).not.toHaveProperty("neonProjectIds");
  });

  it("saves the submitted databases", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: ["np-a", "np-b"] }).neonProjectIds).toEqual(["np-a", "np-b"]);
  });

  it("clears links when an empty list is submitted", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: [] }).neonProjectIds).toEqual([]);
  });

  it("trims, drops blanks, and dedupes", () => {
    expect(buildInfraConfigUpdate({ neonProjectIds: [" np-a ", "", "np-a", "np-b"] }).neonProjectIds).toEqual([
      "np-a",
      "np-b",
    ]);
  });
});
