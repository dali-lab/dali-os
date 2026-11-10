import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn() }));
vi.mock("~/lib/feature-flags.server", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("~/lib/roles", () => ({ getUserRoles: vi.fn(async () => ({})) }));
vi.mock("~/lib/slide-templates.server", async () => {
  const { z } = await import("zod");
  return {
    listSlideTemplates: vi.fn(),
    listForScopes: vi.fn(),
    createSlideTemplate: vi.fn(),
    getSlideTemplate: vi.fn(),
    deleteSlideTemplate: vi.fn(),
    applyDeckTemplate: vi.fn(),
    createTemplateSchema: z.object({ title: z.string().min(1), kind: z.enum(["Deck", "Slide"]) }),
  };
});

import { requireAuth } from "~/lib/auth";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { applyDeckTemplate, createSlideTemplate, deleteSlideTemplate, getSlideTemplate, listForScopes, listSlideTemplates } from "~/lib/slide-templates.server";
import { action, loader } from "../api.slide-templates";
import { action as itemAction, loader as itemLoader } from "../api.slide-templates.$id";
import { action as applyAction } from "../api.slides.$pageId.from-template";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockResolvedValue({ ok: true, user: { sub: "u1" } } as never);
  vi.mocked(isFeatureEnabled).mockResolvedValue(true);
});

const req = (url: string, init?: RequestInit) => new Request(`http://t${url}`, init);
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("/api/slide-templates", () => {
  it("lists through a deck", async () => {
    vi.mocked(listSlideTemplates).mockResolvedValue({ ok: true, templates: [], canSaveToProject: false });
    const res = (await loader({ request: req("/api/slide-templates?pageId=p1") } as never)) as Response;
    expect(await res.json()).toEqual({ templates: [], canSaveToProject: false });
    expect(listSlideTemplates).toHaveBeenCalledWith("u1", "p1", expect.any(Request));
  });

  it("lists for a Drive scope", async () => {
    vi.mocked(listForScopes).mockResolvedValue({ templates: [] });
    await loader({ request: req("/api/slide-templates?projectId=proj1") } as never);
    expect(listForScopes).toHaveBeenCalledWith("u1", "proj1");
  });

  it("returns the lib's refusal", async () => {
    vi.mocked(listSlideTemplates).mockResolvedValue({ ok: false, status: 404, error: "Slide deck not found." });
    expect(((await loader({ request: req("/api/slide-templates?pageId=p1") } as never)) as Response).status).toBe(404);
  });

  it("creates a template with 201", async () => {
    vi.mocked(createSlideTemplate).mockResolvedValue({ ok: true, id: "t1" });
    const res = (await action({ request: req("/api/slide-templates", json({ title: "Kickoff", kind: "Deck" })) } as never)) as Response;
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "t1" });
  });

  it("passes on a forbidden save", async () => {
    vi.mocked(createSlideTemplate).mockResolvedValue({ ok: false, status: 403, error: "no" });
    expect(((await action({ request: req("/api/slide-templates", json({ title: "x", kind: "Slide" })) } as never)) as Response).status).toBe(403);
  });

  it("rejects a bad body and a wrong method", async () => {
    expect(((await action({ request: req("/api/slide-templates", json({ kind: "Deck" })) } as never)) as Response).status).toBe(400);
    expect(((await action({ request: req("/api/slide-templates", { method: "GET" }) } as never)) as Response).status).toBe(405);
    expect(createSlideTemplate).not.toHaveBeenCalled();
  });

  it("is hidden without slides-collab and without sign-in", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect(((await loader({ request: req("/api/slide-templates?pageId=p1") } as never)) as Response).status).toBe(404);
    expect(((await action({ request: req("/api/slide-templates", json({ title: "x", kind: "Deck" })) } as never)) as Response).status).toBe(404);
    vi.mocked(requireAuth).mockResolvedValue({ ok: false, response: new Response("no", { status: 401 }) } as never);
    expect(((await loader({ request: req("/api/slide-templates") } as never)) as Response).status).toBe(401);
  });
});

describe("/api/slide-templates/:id", () => {
  it("returns a template", async () => {
    vi.mocked(getSlideTemplate).mockResolvedValue({ ok: true, template: { id: "t1" } as never });
    const res = (await itemLoader({ request: req("/api/slide-templates/t1"), params: { id: "t1" } } as never)) as Response;
    expect(await res.json()).toEqual({ id: "t1" });
  });

  it("404s a template the person can't use", async () => {
    vi.mocked(getSlideTemplate).mockResolvedValue({ ok: false, status: 404, error: "Template not found." });
    expect(((await itemLoader({ request: req("/api/slide-templates/t1"), params: { id: "t1" } } as never)) as Response).status).toBe(404);
  });

  it("deletes with DELETE only and passes on a refusal", async () => {
    vi.mocked(deleteSlideTemplate).mockResolvedValue({ ok: true });
    expect(((await itemAction({ request: req("/api/slide-templates/t1", { method: "DELETE" }), params: { id: "t1" } } as never)) as Response).status).toBe(200);
    expect(deleteSlideTemplate).toHaveBeenCalledWith("u1", "t1");
    expect(((await itemAction({ request: req("/api/slide-templates/t1", { method: "POST" }), params: { id: "t1" } } as never)) as Response).status).toBe(405);
    vi.mocked(deleteSlideTemplate).mockResolvedValue({ ok: false, status: 403, error: "no" });
    expect(((await itemAction({ request: req("/api/slide-templates/t1", { method: "DELETE" }), params: { id: "t1" } } as never)) as Response).status).toBe(403);
  });
});

describe("POST /api/slides/:pageId/from-template", () => {
  const call = (body: unknown, method = "POST") => applyAction({ request: req("/api/slides/p1/from-template", json(body, method)), params: { pageId: "p1" } } as never) as Promise<Response>;

  it("applies a template to the deck", async () => {
    vi.mocked(applyDeckTemplate).mockResolvedValue({ ok: true, slideIds: ["a"] });
    const res = await call({ templateId: "t1" });
    expect(await res.json()).toEqual({ slideIds: ["a"] });
    expect(applyDeckTemplate).toHaveBeenCalledWith("u1", "p1", "t1", expect.any(Request));
  });

  it("passes on a forbidden apply, and rejects a missing id, a wrong method and the flag off", async () => {
    vi.mocked(applyDeckTemplate).mockResolvedValue({ ok: false, status: 403, error: "no" });
    expect((await call({ templateId: "t1" })).status).toBe(403);
    expect((await call({})).status).toBe(400);
    expect((await call({ templateId: "t1" }, "PUT")).status).toBe(405);
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    expect((await call({ templateId: "t1" })).status).toBe(404);
  });
});
