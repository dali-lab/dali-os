import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/roles", async (orig) => {
  const real = await orig<typeof import("~/lib/roles")>();
  return { ...real, isCore: vi.fn() };
});
vi.mock("~/partners/lib/partner-promote.server", () => ({ promotePartnerApplication: vi.fn() }));

import { isCore } from "~/lib/roles";
import { promotePartnerApplication } from "~/partners/lib/partner-promote.server";
import { NotFoundError } from "~/lib/http-error";
import {
  runPromotePartnerApplication,
  PROMOTE_PARTNER_APPLICATION_TOOL,
} from "../promote-partner-application";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("promote_partner_application", () => {
  it("requires mcp:admin scope", () => {
    expect(PROMOTE_PARTNER_APPLICATION_TOOL.requiredScope).toBe("mcp:admin");
  });

  it("rejects non-Core callers without calling the service", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    await expect(
      runPromotePartnerApplication("u1", { applicationId: "app-1" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(promotePartnerApplication).not.toHaveBeenCalled();
  });

  it("delegates to the service and returns its result unchanged", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(promotePartnerApplication).mockResolvedValue({
      projectId: "proj-new",
      name: "AI Health Tool",
      alreadyExisted: false,
    });
    const out = await runPromotePartnerApplication("u1", { applicationId: "app-1", orgName: "Acme" });
    expect(out).toEqual({ projectId: "proj-new", name: "AI Health Tool", alreadyExisted: false });
    expect(promotePartnerApplication).toHaveBeenCalledWith({
      applicationId: "app-1",
      orgName: "Acme",
      actorUserId: "u1",
    });
  });

  it("lets the service's not-found error through with its status", async () => {
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(promotePartnerApplication).mockRejectedValue(new NotFoundError("nope"));
    await expect(
      runPromotePartnerApplication("u1", { applicationId: "missing" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("describes role requests for the first target term only", () => {
    expect(PROMOTE_PARTNER_APPLICATION_TOOL.description).toContain("first target term");
    expect(PROMOTE_PARTNER_APPLICATION_TOOL.description).not.toContain("every target term");
  });
});
