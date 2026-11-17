import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server");
const requireAuth = vi.fn();
const isAdmin = vi.fn();
const tick = vi.fn();
const runJob = vi.fn();
vi.mock("~/lib/auth", () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));
vi.mock("~/lib/roles", () => ({ isAdmin: (...a: unknown[]) => isAdmin(...a) }));
vi.mock("~/jobs/runner.server", () => ({
  tick: (...a: unknown[]) => tick(...a),
  runJob: (...a: unknown[]) => runJob(...a),
}));

import { prisma } from "~/lib/db.server";
import { action, loader } from "../routes/internal.jobs.tick";

const findMany = (prisma as unknown as { scheduledJob: { findMany: ReturnType<typeof vi.fn> } }).scheduledJob.findMany;

const post = (body?: unknown, headers: Record<string, string> = {}, rawBody?: string) =>
  new Request("https://os.example/internal/jobs/tick", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
const get = (headers: Record<string, string> = {}) =>
  new Request("https://os.example/internal/jobs/tick", { headers });
const call = (request: Request) => action({ request } as never) as Promise<Response>;
const load = (request: Request) => loader({ request } as never) as Promise<Response>;

const SECRET = "s3cret-value";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JOBS_TICK_SECRET = SECRET;
  requireAuth.mockResolvedValue({ ok: false });
  isAdmin.mockResolvedValue(false);
  tick.mockResolvedValue(["digest"]);
  runJob.mockResolvedValue({ ran: true });
});
afterEach(() => {
  delete process.env.JOBS_TICK_SECRET;
});

describe("internal.jobs.tick action", () => {
  it("accepts the shared secret without consulting the session", async () => {
    const res = await call(post(undefined, { "x-jobs-secret": SECRET }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ran: ["digest"] });
    expect(requireAuth).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret with no session", async () => {
    const res = await call(post({ job: "x" }, { "x-jobs-secret": "nope" }));
    expect(res.status).toBe(403);
    expect(tick).not.toHaveBeenCalled();
    expect(runJob).not.toHaveBeenCalled();
  });

  it.each([["empty header", ""], ["literal undefined", "undefined"]])(
    "does not authorize an %s when the secret is unset",
    async (_name, header) => {
      delete process.env.JOBS_TICK_SECRET;
      const res = await call(post(undefined, { "x-jobs-secret": header }));
      expect(res.status).toBe(403);
      expect(tick).not.toHaveBeenCalled();
    },
  );

  it("rejects an authenticated non-admin and checks isAdmin with the user sub", async () => {
    requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    const res = await call(post());
    expect(res.status).toBe(403);
    expect(isAdmin).toHaveBeenCalledWith("u1");
    expect(tick).not.toHaveBeenCalled();
  });

  it("accepts an Admin session", async () => {
    requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
    isAdmin.mockResolvedValue(true);
    const res = await call(post());
    expect(res.status).toBe(200);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("returns 405 for a non-POST method", async () => {
    const res = await call(new Request("https://os.example/internal/jobs/tick", { method: "PUT", headers: { "x-jobs-secret": SECRET } }));
    expect(res.status).toBe(405);
    expect(tick).not.toHaveBeenCalled();
  });

  it("runs one named job forced", async () => {
    const res = await call(post({ job: "digest" }, { "x-jobs-secret": SECRET }));
    expect(runJob).toHaveBeenCalledWith("digest", { force: true });
    expect(tick).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, ran: ["digest"], error: null });
  });

  it("returns 409 with the error when the job did not run", async () => {
    runJob.mockResolvedValue({ ran: false, error: "already running" });
    const res = await call(post({ job: "digest" }, { "x-jobs-secret": SECRET }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "already running" });
  });

  it("runs the full tick for an invalid or empty JSON body", async () => {
    await call(post(undefined, { "x-jobs-secret": SECRET }, "{not json"));
    await call(post(undefined, { "x-jobs-secret": SECRET }));
    expect(tick).toHaveBeenCalledTimes(2);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("falls back to the full tick when job is not a string", async () => {
    await call(post({ job: 123 }, { "x-jobs-secret": SECRET }));
    expect(tick).toHaveBeenCalledTimes(1);
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe("internal.jobs.tick loader", () => {
  it("returns 403 for a non-admin", async () => {
    const res = await load(get());
    expect(res.status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([
    ["the secret", { "x-jobs-secret": SECRET }, false],
    ["an Admin session", {}, true],
  ])("lists jobs ordered by name for %s", async (_n, headers, admin) => {
    if (admin) {
      requireAuth.mockResolvedValue({ ok: true, user: { sub: "u1" } });
      isAdmin.mockResolvedValue(true);
    }
    findMany.mockResolvedValue([{ name: "a" }]);
    const res = await load(get(headers));
    expect(await res.json()).toEqual({ jobs: [{ name: "a" }] });
    expect(findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
  });
});
