import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })),
}));
vi.mock("~/lib/roles");
vi.mock("~/partners/lib/partner-application-create.server", () => ({
  createPartnerApplication: vi.fn(),
}));

import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { createPartnerApplication } from "~/partners/lib/partner-application-create.server";
import { action } from "~/partners/routes/api.partner-applications";

function callAction(body: unknown, method = "POST") {
  const request = new Request("http://localhost/api/partner-applications", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return action({ request, params: {}, context: {} } as any);
}

const VALID_BODY = { title: "A pitch", applicantEmail: "a@b.com" };

beforeEach(() => {
  vi.clearAllMocks();
  (requireAuth as any).mockResolvedValue({
    ok: true,
    user: { sub: "core-1", type: "member", email: "c@dali" },
  });
  (isCore as any).mockResolvedValue(true);
  (createPartnerApplication as any).mockResolvedValue({ id: "app-1" });
});

describe("POST /api/partner-applications", () => {
  it("rejects non-Core callers", async () => {
    (isCore as any).mockResolvedValue(false);
    const res = (await callAction(VALID_BODY)) as Response;
    expect(res.status).toBe(403);
    expect(createPartnerApplication).not.toHaveBeenCalled();
  });

  it("rejects a non-POST method", async () => {
    const res = (await callAction(VALID_BODY, "GET")) as Response;
    expect(res.status).toBe(405);
  });

  it("rejects a body missing the required fields", async () => {
    const res = (await callAction({ title: "A pitch" })) as Response;
    expect(res.status).toBe(400);
    expect(createPartnerApplication).not.toHaveBeenCalled();
  });

  it("creates the application and returns its id", async () => {
    const res = (await callAction({
      title: "A pitch",
      applicantEmail: "a@b.com",
      targetTermIds: ["t1"],
      domainIds: ["d1"],
    })) as Response;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: "app-1" });
    expect(createPartnerApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "A pitch",
        applicantEmail: "a@b.com",
        targetTermIds: ["t1"],
        domainIds: ["d1"],
        actorUserId: "core-1",
      }),
    );
  });

  it("surfaces a validation error from the shared helper as a 400", async () => {
    (createPartnerApplication as any).mockResolvedValue({ error: "A title is required." });
    const res = (await callAction(VALID_BODY)) as Response;
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "A title is required." });
  });
});
