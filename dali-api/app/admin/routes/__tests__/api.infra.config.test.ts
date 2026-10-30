import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(null, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/db.server", () => ({ prisma: { project: { findUnique: vi.fn() } } }));
vi.mock("~/lib/infra/config-save.server", () => ({ saveInfraConfig: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { prisma } from "~/lib/db.server";
import { saveInfraConfig } from "~/lib/infra/config-save.server";
import { action } from "~/admin/routes/api.infra.config";

function post() {
  const body = new FormData();
  body.append("projectId", "p1");
  body.append("neonOrgId", "org-dali-1");
  return action({ request: new Request("http://x/api/infra/config", { method: "POST", body }), params: {}, context: {} } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(getUserRoles).mockResolvedValue({ isCore: true } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ id: "p1" } as never);
  vi.mocked(saveInfraConfig).mockResolvedValue({ ok: true });
});

describe("api.infra.config", () => {
  it("saves through the shared save path for Core", async () => {
    const res = (await post()) as Response;
    expect(await res.json()).toEqual({ ok: true });
    expect(vi.mocked(saveInfraConfig).mock.calls[0][0]).toMatchObject({ userId: "u1", projectId: "p1" });
  });

  it("refuses non-Core", async () => {
    vi.mocked(getUserRoles).mockResolvedValue({ isCore: false } as never);
    expect(((await post()) as Response).status).toBe(403);
    expect(saveInfraConfig).not.toHaveBeenCalled();
  });

  it("refuses while the infra-dashboard flag is off", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(((await post()) as Response).status).toBe(403);
    expect(saveInfraConfig).not.toHaveBeenCalled();
  });

  it("404s an unknown project", async () => {
    vi.mocked(prisma.project.findUnique).mockResolvedValue(null);
    expect(((await post()) as Response).status).toBe(404);
    expect(saveInfraConfig).not.toHaveBeenCalled();
  });

  it("passes an unauthenticated response through", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) } as never);
    expect(((await post()) as Response).status).toBe(401);
  });
});
