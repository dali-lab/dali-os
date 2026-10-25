import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/admin/routes/admin.members", () => ({ action: vi.fn() }));
vi.mock("~/admin/routes/admin.domains", () => ({ action: vi.fn() }));
vi.mock("~/core/lib/access.server", () => ({ loadAccess: vi.fn() }));
vi.mock("~/core/components/access/RolesDomainsPage", () => ({ RolesDomainsPage: () => null }));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isAdmin: vi.fn(), isCore: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));

import { action as rolesAction } from "~/admin/routes/admin.members";
import { action as domainsAction } from "~/admin/routes/admin.domains";
import { requireAuth } from "~/lib/auth";
import { isAdmin, isCore } from "~/lib/roles";
import { loadAccess } from "~/core/lib/access.server";
import { action, loader, INTENT_OWNER } from "~/core/routes/core.access";
import { loader as rolesRedirect } from "~/core/routes/core.access.roles";
import { loader as domainsRedirect } from "~/core/routes/core.access.domains";

function post(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return action({
    request: new Request("http://localhost/core/access", { method: "POST", body, headers: { cookie: "__dali_sid=abc" } }),
    params: {},
    context: {},
  } as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(rolesAction).mockResolvedValue(null as never);
  vi.mocked(domainsAction).mockResolvedValue(null as never);
});

describe("core.access action", () => {
  it("sends role, Core title and lead changes to the roles action", async () => {
    for (const intent of ["set-admin", "set-staff", "add-core-title", "remove-core-title", "add-domain-lead", "remove-domain-lead"]) {
      await post({ intent, userId: "u1" });
    }
    expect(rolesAction).toHaveBeenCalledTimes(6);
    expect(domainsAction).not.toHaveBeenCalled();
  });

  it("sends domain and level changes to the domains action", async () => {
    for (const intent of ["create-domain", "delete-domain", "add-eligibility", "set-eligibility-level", "remove-eligibility"]) {
      await post({ intent });
    }
    expect(domainsAction).toHaveBeenCalledTimes(5);
    expect(rolesAction).not.toHaveBeenCalled();
  });

  it("forwards the form and the session, so the old permission checks still run", async () => {
    await post({ intent: "set-admin", userId: "u1", value: "true" });
    const forwarded = vi.mocked(rolesAction).mock.calls[0]![0].request as Request;
    expect(forwarded.headers.get("cookie")).toBe("__dali_sid=abc");
    const form = await forwarded.formData();
    expect(Object.fromEntries(form)).toEqual({ intent: "set-admin", userId: "u1", value: "true" });
  });

  it("refuses intents neither page owned", async () => {
    const res = (await post({ intent: "drop-table" })) as Response;
    expect(res.status).toBe(400);
    expect(rolesAction).not.toHaveBeenCalled();
    expect(domainsAction).not.toHaveBeenCalled();
  });

  it("covers every intent the two old pages handled", () => {
    expect(Object.keys(INTENT_OWNER).sort()).toEqual(
      [
        "add-core-title",
        "add-domain-lead",
        "add-eligibility",
        "create-domain",
        "delete-domain",
        "remove-core-title",
        "remove-domain-lead",
        "remove-eligibility",
        "set-admin",
        "set-eligibility-level",
        "set-staff",
      ].sort(),
    );
  });
});

describe("core.access loader", () => {
  it("sends non-Core viewers home", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await loader({ request: new Request("http://localhost/core/access"), params: {}, context: {} } as never)) as Response;
    expect(res.headers.get("Location")).toBe("/");
    expect(loadAccess).not.toHaveBeenCalled();
  });

  it("tells the page whether the viewer is an admin", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
    vi.mocked(isCore).mockResolvedValue(true);
    vi.mocked(isAdmin).mockResolvedValue(false);
    vi.mocked(loadAccess).mockResolvedValue({ members: [], domains: [], term: "Fall 2026" });
    const data = await loader({ request: new Request("http://localhost/core/access"), params: {}, context: {} } as never);
    expect(data).toMatchObject({ viewerIsAdmin: false, term: "Fall 2026" });
  });
});

describe("old access URLs", () => {
  it("redirect to the combined page and keep the query string", () => {
    const r1 = rolesRedirect({ request: new Request("http://localhost/core/access/roles?q=maya") });
    const r2 = domainsRedirect({ request: new Request("http://localhost/core/access/domains") });
    expect(r1.headers.get("Location")).toBe("/core/access?q=maya");
    expect(r2.headers.get("Location")).toBe("/core/access");
  });
});
