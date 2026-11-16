import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { partnerOrg: { findUnique: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), isNonMember: vi.fn() }));
vi.mock("~/lib/login-next", () => ({
  redirectToLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: "/login" } })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/lib/user-pages.server", () => ({ recordRouteVisit: vi.fn() }));
vi.mock("~/lib/photo", () => ({ resolvePhotoUrl: vi.fn() }));
vi.mock("../../lib/partner-activity-page.server", () => ({ loadPartnerActivityPage: vi.fn() }));
vi.mock("../../lib/invites.server", () => ({ listPendingInvites: vi.fn() }));
vi.mock("../../lib/org-actions.server", () => ({ runPartnerOrgAction: vi.fn() }));

import { prisma } from "~/lib/db.server";
import { requireAuth, isNonMember } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { runPartnerOrgAction } from "../../lib/org-actions.server";
import { loadPartnerOrgDetail } from "../../lib/org-detail.server";
import { action, loader } from "../core.partners.orgs.$orgId";

const db = prisma as any;

function formRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request("http://localhost/core/partners/orgs/org1", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isNonMember).mockResolvedValue(false);
  vi.mocked(isCore).mockResolvedValue(true);
});

describe("partner org loader gate", () => {
  it("sends a non-member to the portal", async () => {
    vi.mocked(isNonMember).mockResolvedValue(true);
    const res = (await loadPartnerOrgDetail(new Request("http://localhost/x"), "org1")) as Response;
    expect(res.headers.get("Location")).toBe("/portal");
  });

  it("sends a non-Core member home", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    const res = (await loader({
      request: new Request("http://localhost/x"),
      params: { orgId: "org1" },
    } as never)) as Response;
    expect(res.headers.get("Location")).toBe("/");
  });

  it("404s on an unknown org", async () => {
    db.partnerOrg.findUnique.mockResolvedValue(null);
    await expect(
      loadPartnerOrgDetail(new Request("http://localhost/x"), "missing"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("partner org action gate", () => {
  const args = (fields: Record<string, string>) =>
    ({ request: formRequest(fields), params: { orgId: "org1" } }) as never;

  it("refuses a non-Core user before touching the org", async () => {
    vi.mocked(isCore).mockResolvedValue(false);
    expect(await action(args({ intent: "note", body: "x" }))).toEqual({
      error: "You don't have permission to edit organizations.",
    });
    expect(db.partnerOrg.findUnique).not.toHaveBeenCalled();
    expect(runPartnerOrgAction).not.toHaveBeenCalled();
  });

  it("404s when the org does not exist", async () => {
    db.partnerOrg.findUnique.mockResolvedValue(null);
    await expect(action(args({ intent: "note" }))).rejects.toMatchObject({ status: 404 });
  });

  it("hands the intent to the handler map with the actor", async () => {
    const org = { id: "org1", name: "Acme", primaryContactId: null, isIndividual: false };
    db.partnerOrg.findUnique.mockResolvedValue(org);
    vi.mocked(runPartnerOrgAction).mockResolvedValue({ ok: true });
    expect(await action(args({ intent: "note", body: "hi" }))).toEqual({ ok: true });
    const [ctx, intent] = vi.mocked(runPartnerOrgAction).mock.calls[0];
    expect(intent).toBe("note");
    expect(ctx.org).toBe(org);
    expect(ctx.userId).toBe("u1");
    expect(ctx.actor.actorUserId).toBe("u1");
    expect(ctx.form.get("body")).toBe("hi");
  });
});
