import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => Response.json({ error: "Forbidden" }, { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ canManageStaffing: vi.fn() }));
vi.mock("~/lib/cors", () => ({
  withCors: (_req: Request, res: Response) => res,
  handlePreflight: vi.fn(() => null),
}));
vi.mock("../../lib/finalize-staffing.server", () => {
  class FinalizeNotFoundError extends Error {}
  class FinalizeInputError extends Error {}
  return { finalizeStaffing: vi.fn(), FinalizeNotFoundError, FinalizeInputError };
});

import { action } from "../api.staffing.finalize";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { handlePreflight } from "~/lib/cors";
import {
  finalizeStaffing,
  FinalizeInputError,
  FinalizeNotFoundError,
} from "../../lib/finalize-staffing.server";

const ACTOR = "lead-1";

function makeRequest(body: unknown, method = "POST") {
  return new Request("http://localhost/api/staffing/finalize", {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
function call(body: unknown, method = "POST") {
  return action({ request: makeRequest(body, method) } as any);
}
const valid = { cycleId: "cyc-1", projectId: "proj-1", automations: ["assignments"] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(handlePreflight).mockReturnValue(null);
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: ACTOR } } as any);
  vi.mocked(canManageStaffing).mockResolvedValue(true);
  vi.mocked(finalizeStaffing).mockResolvedValue({ results: {} } as never);
});

describe("POST /api/staffing/finalize", () => {
  it("returns the CORS preflight response without authenticating", async () => {
    vi.mocked(handlePreflight).mockReturnValue(new Response(null, { status: 204 }));
    expect((await call(valid, "OPTIONS")).status).toBe(204);
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("returns the auth response when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as any);
    expect((await call(valid)).status).toBe(401);
    expect(finalizeStaffing).not.toHaveBeenCalled();
  });

  it("rejects non-POST with 405", async () => {
    const res = await call(valid, "PUT");
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "Method not allowed" });
    expect(finalizeStaffing).not.toHaveBeenCalled();
  });

  it("rejects callers who cannot manage staffing with 403", async () => {
    vi.mocked(canManageStaffing).mockResolvedValue(false);
    expect((await call(valid)).status).toBe(403);
    expect(canManageStaffing).toHaveBeenCalledWith(ACTOR);
    expect(finalizeStaffing).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400", async () => {
    const res = await call("{nope");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
    expect(finalizeStaffing).not.toHaveBeenCalled();
  });

  it.each([
    ["null body", null],
    ["missing cycleId", { projectId: "p", automations: [] }],
    ["missing projectId", { cycleId: "c", automations: [] }],
    ["non-array automations", { cycleId: "c", projectId: "p", automations: "assignments" }],
    ["non-string automation entry", { cycleId: "c", projectId: "p", automations: [1] }],
    ["non-string slackChannel", { cycleId: "c", projectId: "p", automations: [], slackChannel: 3 }],
    ["non-string githubTeamSlug", { cycleId: "c", projectId: "p", automations: [], githubTeamSlug: 3 }],
    ["non-boolean promoteMentors", { cycleId: "c", projectId: "p", automations: [], promoteMentors: "yes" }],
    ["non-boolean saveFieldsOnly", { cycleId: "c", projectId: "p", automations: [], saveFieldsOnly: 1 }],
  ])("rejects an invalid body: %s", async (_name, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid body" });
    expect(finalizeStaffing).not.toHaveBeenCalled();
  });

  it("passes the actor, the validated body and the request to finalizeStaffing", async () => {
    const body = {
      ...valid,
      slackChannel: "atlas",
      githubTeamSlug: "atlas-team",
      saveFieldsOnly: false,
      promoteMentors: true,
    };
    const request = makeRequest(body);
    await action({ request } as any);
    expect(finalizeStaffing).toHaveBeenCalledWith(ACTOR, body, request);
  });

  it("returns the lib's results unchanged with 200", async () => {
    const results = { assignments: { status: "ok", message: "2 confirmed" } };
    vi.mocked(finalizeStaffing).mockResolvedValue({ results } as never);
    const res = await call(valid);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results });
  });

  it("returns { saved: true } for a fields-only save", async () => {
    vi.mocked(finalizeStaffing).mockResolvedValue({ saved: true });
    const res = await call({ ...valid, automations: [], saveFieldsOnly: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ saved: true });
  });

  it("maps not-found errors to 404 with the lib's message", async () => {
    vi.mocked(finalizeStaffing).mockRejectedValue(new FinalizeNotFoundError("Cycle not found"));
    const res = await call(valid);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Cycle not found" });
  });

  it("maps an empty automation selection to 400 with the lib's message", async () => {
    vi.mocked(finalizeStaffing).mockRejectedValue(new FinalizeInputError("No automations selected"));
    const res = await call({ ...valid, automations: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No automations selected" });
  });

  it("lets unexpected errors propagate", async () => {
    vi.mocked(finalizeStaffing).mockRejectedValue(new Error("db down"));
    await expect(call(valid)).rejects.toThrow("db down");
  });
});
