import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/db.server");
vi.mock("~/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth")>()),
  requireAuth: vi.fn(),
}));
vi.mock("~/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(),
}));
vi.mock("~/forms/lib/public-form", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/forms/lib/public-form")>()),
  formAccessMeta: vi.fn(),
  formFillAccess: vi.fn(),
  submitAnonymousForm: vi.fn(),
  submitMemberForm: vi.fn(),
}));

vi.mock("~/forms/lib/form-response.server", () => ({ editOwnResponse: vi.fn() }));

import { requireAuth } from "~/lib/auth";
import { editOwnResponse } from "~/forms/lib/form-response.server";
import { checkRateLimit, getClientIp } from "~/lib/rate-limit";
import {
  formAccessMeta,
  formFillAccess,
  submitAnonymousForm,
  submitMemberForm,
} from "~/forms/lib/public-form";
import { action } from "~/routes/api.forms.fill.$token";

const mockAuth = requireAuth as ReturnType<typeof vi.fn>;
const mockRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;
const mockIp = getClientIp as ReturnType<typeof vi.fn>;
const mockMeta = formAccessMeta as ReturnType<typeof vi.fn>;
const mockAccess = formFillAccess as ReturnType<typeof vi.fn>;
const mockAnon = submitAnonymousForm as ReturnType<typeof vi.fn>;
const mockMember = submitMemberForm as ReturnType<typeof vi.fn>;

const META = {
  id: "form-1",
  name: "Survey",
  audience: "Public",
  audienceGroupIds: [],
};

function post(body: Record<string, unknown> = {}) {
  const request = new Request("http://localhost/api/forms/fill/tok", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      versionId: "ver-1",
      answers: { q1: "hi" },
      ...body,
    }),
  });
  return action({ request, params: { token: "tok" } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMeta.mockResolvedValue(META);
  mockAuth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
  mockIp.mockReturnValue("1.2.3.4");
  mockRateLimit.mockReturnValue(null);
  mockAnon.mockResolvedValue({ ok: true });
  mockMember.mockResolvedValue({ ok: true });
});

describe("POST /api/forms/fill/:token", () => {
  it("routes an anonymous Public fill to submitAnonymousForm with the IP", async () => {
    mockAccess.mockResolvedValue("ok");

    const res = (await post()) as Response;

    expect(res.status).toBe(201);
    expect(mockAnon).toHaveBeenCalledWith({
      token: "tok",
      versionId: "ver-1",
      answers: { q1: "hi" },
      submitterIp: "1.2.3.4",
    });
    expect(mockMember).not.toHaveBeenCalled();
  });

  it("401s an anonymous visitor on a non-public form", async () => {
    mockAccess.mockResolvedValue("login");

    const res = (await post()) as Response;

    expect(res.status).toBe(401);
    expect(mockAnon).not.toHaveBeenCalled();
    expect(mockMember).not.toHaveBeenCalled();
  });

  it("403s a signed-in user outside the audience", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "user-1" } });
    mockAccess.mockResolvedValue("denied");

    const res = (await post()) as Response;

    expect(res.status).toBe(403);
    expect(mockMember).not.toHaveBeenCalled();
  });

  it("rate-limits anonymous submits before writing", async () => {
    mockAccess.mockResolvedValue("ok");
    mockRateLimit.mockReturnValue(
      new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
    );

    const res = (await post()) as Response;

    expect(res.status).toBe(429);
    expect(mockAnon).not.toHaveBeenCalled();
  });

  it("does not rate-limit signed-in submits", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "user-1" } });
    mockAccess.mockResolvedValue("ok");

    const res = (await post()) as Response;

    expect(res.status).toBe(201);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });

  it("education context bypasses the audience gate but requires a session", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "student-1" } });

    const res = (await post({ educationSessionId: "sess-1" })) as Response;

    expect(res.status).toBe(201);
    expect(mockAccess).not.toHaveBeenCalled();
    expect(mockMember).toHaveBeenCalledWith(
      expect.objectContaining({
        education: { sessionId: "sess-1", offeringId: null },
      }),
    );

    // Same request without a session → the auth failure response wins.
    mockAuth.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const anon = (await post({ educationSessionId: "sess-1" })) as Response;
    expect(anon.status).toBe(401);
  });

  it("404s an unknown/unpublished token before anything else", async () => {
    mockMeta.mockResolvedValue(null);

    const res = (await post()) as Response;

    expect(res.status).toBe(404);
    expect(mockAccess).not.toHaveBeenCalled();
  });
});

describe("PATCH edit of your own response", () => {
  const patch = (body: unknown = { answers: { q1: "fixed" } }) =>
    action({
      request: new Request("http://localhost/api/forms/fill/tok", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      params: { token: "tok" },
    } as never) as Promise<Response>;

  beforeEach(() => {
    mockAuth.mockResolvedValue({ ok: true, user: { sub: "user-1" } });
    vi.mocked(editOwnResponse).mockResolvedValue({ ok: true });
  });

  it("edits as the session user and never runs the submit path", async () => {
    const res = await patch();
    expect(res.status).toBe(200);
    expect(editOwnResponse).toHaveBeenCalledWith({
      token: "tok",
      userId: "user-1",
      answers: { q1: "fixed" },
      request: expect.any(Request),
    });
    expect(mockMember).not.toHaveBeenCalled();
    expect(mockAnon).not.toHaveBeenCalled();
  });

  it("requires a session", async () => {
    mockAuth.mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) });
    expect((await patch()).status).toBe(401);
    expect(editOwnResponse).not.toHaveBeenCalled();
  });

  it("relays a refusal with its status", async () => {
    vi.mocked(editOwnResponse).mockResolvedValue({ error: "closed", status: 403 });
    const res = await patch();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "closed" });
  });

  it("rejects a body without answers", async () => {
    expect((await patch({})).status).toBe(400);
    expect(editOwnResponse).not.toHaveBeenCalled();
  });
});
