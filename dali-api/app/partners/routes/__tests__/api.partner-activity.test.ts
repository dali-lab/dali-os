import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireCore: vi.fn() }));
vi.mock("~/partners/lib/partner-activity-page.server", () => ({ loadPartnerActivityPage: vi.fn() }));

import { requireCore } from "~/lib/auth";
import { loadPartnerActivityPage } from "~/partners/lib/partner-activity-page.server";
import { loader } from "~/partners/routes/api.partner-activity";

function call(query: string) {
  const request = new Request(`http://localhost/api/partner-activity${query}`);
  return loader({ request, params: {}, context: {} } as any) as Promise<Response>;
}

describe("GET /api/partner-activity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCore).mockResolvedValue({ ok: true, auth: {} } as any);
    vi.mocked(loadPartnerActivityPage).mockResolvedValue({ items: [], nextCursor: null, actorNames: {} });
  });

  it("returns the gate response and loads nothing for a non-Core viewer", async () => {
    const denied = new Response("no", { status: 403 });
    vi.mocked(requireCore).mockResolvedValue({ ok: false, response: denied } as any);
    expect(await call("?orgId=o1")).toBe(denied);
    expect(loadPartnerActivityPage).not.toHaveBeenCalled();
  });

  it("rejects a request with neither or both scopes", async () => {
    expect((await call("")).status).toBe(400);
    expect((await call("?orgId=o1&contactId=c1")).status).toBe(400);
    expect(loadPartnerActivityPage).not.toHaveBeenCalled();
  });

  it("loads an org page with the cursor", async () => {
    vi.mocked(loadPartnerActivityPage).mockResolvedValue({
      items: [], nextCursor: "x|y", actorNames: { u1: "Ada Lovelace" },
    });
    const res = await call("?orgId=o1&cursor=2026-10-01T00:00:00.000Z%7Ca1");
    expect(loadPartnerActivityPage).toHaveBeenCalledWith({ orgId: "o1" }, "2026-10-01T00:00:00.000Z|a1");
    expect(await res.json()).toEqual({ items: [], nextCursor: "x|y", actorNames: { u1: "Ada Lovelace" } });
  });

  it("loads a contact page from the start without a cursor", async () => {
    await call("?contactId=c1");
    expect(loadPartnerActivityPage).toHaveBeenCalledWith({ contactId: "c1" }, null);
  });
});
