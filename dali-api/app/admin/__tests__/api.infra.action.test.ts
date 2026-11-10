import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("~/lib/db.server", () => ({
  prisma: { project: { update: vi.fn() } },
}));
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  forbidden: vi.fn(() => new Response("Forbidden", { status: 403 })),
}));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn(), isAdmin: vi.fn() }));
vi.mock("~/lib/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("~/lib/infra/project-infra.server", () => ({ getProjectInfraCreds: vi.fn() }));
vi.mock("~/lib/infra/fly.server", () => ({
  machineAction: vi.fn(),
  scaleMachine: vi.fn(),
  destroyApp: vi.fn(),
  destroyMachine: vi.fn(),
  destroyVolume: vi.fn(),
}));
vi.mock("~/lib/infra/neon.server", () => ({
  endpointAction: vi.fn(),
  updateEndpoint: vi.fn(),
  pollOperations: vi.fn(),
  setProjectQuota: vi.fn(),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteBranch: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { getProjectInfraCreds } from "~/lib/infra/project-infra.server";
import * as fly from "~/lib/infra/fly.server";
import * as neon from "~/lib/infra/neon.server";
import { action } from "~/admin/routes/api.infra.action";

const m = <T,>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

function call(body: unknown, raw?: string) {
  const request = new Request("http://x/api/infra/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
  return action({ request } as Parameters<typeof action>[0]) as Promise<Response>;
}

const ADMIN_BODIES: Record<string, Record<string, unknown>> = {
  "fly.destroy": { intent: "fly.destroy", projectId: "p1", target: "app", app: "client-app" },
  "neon.quota": {
    intent: "neon.quota",
    projectId: "p1",
    neonProjectId: "n1",
    quota: { active_time_seconds: 10 },
  },
  "neon.project.create": { intent: "neon.project.create", projectId: "p1", name: "db" },
  "neon.project.delete": { intent: "neon.project.delete", projectId: "p1", neonProjectId: "n1" },
  "neon.branch.delete": {
    intent: "neon.branch.delete",
    projectId: "p1",
    neonProjectId: "n1",
    branchId: "b1",
  },
  reap: { intent: "reap", projectId: "p1", kind: "fly-app", app: "client-app" },
};

const CORE_BODIES: Record<string, Record<string, unknown>> = {
  "fly.machine": {
    intent: "fly.machine",
    projectId: "p1",
    app: "client-app",
    machineId: "m1",
    kind: "restart",
  },
  "fly.scale": {
    intent: "fly.scale",
    projectId: "p1",
    app: "client-app",
    machineId: "m1",
    cpuKind: "shared",
    cpus: 2,
    memoryMb: 512,
  },
  "neon.endpoint": {
    intent: "neon.endpoint",
    projectId: "p1",
    neonProjectId: "n1",
    endpointId: "e1",
    kind: "suspend",
  },
  "neon.autoscale": {
    intent: "neon.autoscale",
    projectId: "p1",
    neonProjectId: "n1",
    endpointId: "e1",
    minCu: 0.5,
  },
};

const WRITES = [
  fly.machineAction,
  fly.scaleMachine,
  fly.destroyApp,
  fly.destroyMachine,
  fly.destroyVolume,
  neon.endpointAction,
  neon.updateEndpoint,
  neon.setProjectQuota,
  neon.createProject,
  neon.deleteProject,
  neon.deleteBranch,
];

function expectNoWrites() {
  for (const w of WRITES) expect(w).not.toHaveBeenCalled();
  expect(logAuditEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  m(requireAuth).mockResolvedValue({ ok: true, user: { sub: "ada" } });
  m(isCore).mockResolvedValue(true);
  m(isAdmin).mockResolvedValue(false);
  m(getProjectInfraCreds).mockResolvedValue({ flyWriteToken: "fly-write-fake", neonOrgId: "org-1" });
  m(neon.pollOperations).mockResolvedValue(undefined);
  m(neon.endpointAction).mockResolvedValue(["op1"]);
  m(neon.updateEndpoint).mockResolvedValue(["op2"]);
  m(neon.deleteBranch).mockResolvedValue(["op3"]);
  m(neon.createProject).mockResolvedValue({ projectId: "new-n", operations: ["op4"] });
  delete process.env.INFRA_PROTECTED_NEON_PROJECTS;
  delete process.env.INFRA_PROTECTED_FLY_APPS;
});

afterEach(() => {
  delete process.env.INFRA_PROTECTED_NEON_PROJECTS;
  delete process.env.INFRA_PROTECTED_FLY_APPS;
});

describe("infra action auth and roles", () => {
  it("returns the auth response when unauthenticated, before touching anything", async () => {
    const denied = new Response("nope", { status: 401 });
    m(requireAuth).mockResolvedValue({ ok: false, response: denied });
    const res = await call(CORE_BODIES["fly.machine"]);
    expect(res).toBe(denied);
    expect(isCore).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("rejects a non-Core member with 403 for every intent", async () => {
    m(isCore).mockResolvedValue(false);
    for (const body of [...Object.values(CORE_BODIES), ...Object.values(ADMIN_BODIES)]) {
      const res = await call(body);
      expect(res.status).toBe(403);
    }
    expect(getProjectInfraCreds).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(Object.keys(ADMIN_BODIES))("denies %s to Core members who are not Admin", async (intent) => {
    const res = await call(ADMIN_BODIES[intent]);
    expect(res.status).toBe(403);
    expect(getProjectInfraCreds).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(Object.keys(CORE_BODIES))("allows %s for Core without an Admin check", async (intent) => {
    const res = await call(CORE_BODIES[intent]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it.each(Object.keys(ADMIN_BODIES))("allows %s for Admin", async (intent) => {
    m(isAdmin).mockResolvedValue(true);
    const res = await call(ADMIN_BODIES[intent]);
    expect(res.status).toBe(200);
  });
});

describe("infra action validation", () => {
  it("400s on malformed JSON", async () => {
    const res = await call(null, "{not json");
    expect(res.status).toBe(400);
  });

  it("400s on an unknown intent", async () => {
    const res = await call({ intent: "fly.explode", projectId: "p1" });
    expect(res.status).toBe(400);
    expectNoWrites();
  });

  it("400s when a required field is missing", async () => {
    const { machineId: _m, ...body } = CORE_BODIES["fly.machine"];
    const res = await call(body);
    expect(res.status).toBe(400);
    expectNoWrites();
  });

  it("rejects out-of-range scale values", async () => {
    for (const patch of [{ cpus: 17 }, { cpus: 0 }, { cpus: 1.5 }, { memoryMb: 128 }, { cpuKind: "gpu" }]) {
      const res = await call({ ...CORE_BODIES["fly.scale"], ...patch });
      expect(res.status).toBe(400);
    }
    expect(fly.scaleMachine).not.toHaveBeenCalled();
  });

  it("rejects an empty neon quota and empty/oversized project names for Admin", async () => {
    m(isAdmin).mockResolvedValue(true);
    expect((await call({ ...ADMIN_BODIES["neon.quota"], quota: {} })).status).toBe(400);
    expect((await call({ ...ADMIN_BODIES["neon.project.create"], name: "" })).status).toBe(400);
    expect(
      (await call({ ...ADMIN_BODIES["neon.project.create"], name: "x".repeat(129) })).status,
    ).toBe(400);
    expectNoWrites();
  });

  it("404s on an unknown project", async () => {
    m(getProjectInfraCreds).mockResolvedValue(null);
    const res = await call(CORE_BODIES["neon.endpoint"]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Unknown project" });
    expectNoWrites();
  });
});

describe("infra action per-intent behavior", () => {
  it("fly.machine passes the write token and audits", async () => {
    await call(CORE_BODIES["fly.machine"]);
    expect(fly.machineAction).toHaveBeenCalledWith("fly-write-fake", "client-app", "m1", "restart");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "infra.fly.action",
        userId: "ada",
        targetId: "m1",
        metadata: { projectId: "p1", app: "client-app", kind: "restart" },
      }),
    );
  });

  it.each(["fly.machine", "fly.scale"])("%s 400s without a Fly write token", async (intent) => {
    m(getProjectInfraCreds).mockResolvedValue({ flyWriteToken: null });
    const res = await call(CORE_BODIES[intent]);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No Fly write token configured for this project" });
    expectNoWrites();
  });

  it("fly.scale maps fields to the Fly API shape and audits them", async () => {
    await call(CORE_BODIES["fly.scale"]);
    expect(fly.scaleMachine).toHaveBeenCalledWith("fly-write-fake", "client-app", "m1", {
      cpu_kind: "shared",
      cpus: 2,
      memory_mb: 512,
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "infra.fly.action",
        metadata: expect.objectContaining({ kind: "scale", cpus: 2, memoryMb: 512 }),
      }),
    );
  });

  it("neon.endpoint polls operations, tolerates poll failure, and audits", async () => {
    m(neon.pollOperations).mockRejectedValue(new Error("timeout"));
    const res = await call(CORE_BODIES["neon.endpoint"]);
    expect(res.status).toBe(200);
    expect(neon.endpointAction).toHaveBeenCalledWith("n1", "e1", "suspend");
    expect(neon.pollOperations).toHaveBeenCalledWith("n1", ["op1"]);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "infra.neon.endpoint", targetId: "e1" }),
    );
  });

  it("neon.autoscale only sends the provided fields", async () => {
    await call({ ...CORE_BODIES["neon.autoscale"], maxCu: 4, suspendTimeoutSeconds: -1 });
    expect(neon.updateEndpoint).toHaveBeenCalledWith("n1", "e1", {
      autoscaling_limit_min_cu: 0.5,
      autoscaling_limit_max_cu: 4,
      suspend_timeout_seconds: -1,
    });
  });

  it("neon.autoscale 400s when nothing is provided", async () => {
    const res = await call({
      intent: "neon.autoscale",
      projectId: "p1",
      neonProjectId: "n1",
      endpointId: "e1",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Nothing to update" });
    expect(neon.updateEndpoint).not.toHaveBeenCalled();
  });

  describe("fly.destroy", () => {
    beforeEach(() => m(isAdmin).mockResolvedValue(true));

    it("destroys by target type and audits the right target id", async () => {
      await call({ ...ADMIN_BODIES["fly.destroy"], target: "app" });
      expect(fly.destroyApp).toHaveBeenCalledWith("fly-write-fake", "client-app");
      await call({ ...ADMIN_BODIES["fly.destroy"], target: "machine", machineId: "m9" });
      expect(fly.destroyMachine).toHaveBeenCalledWith("fly-write-fake", "client-app", "m9");
      await call({ ...ADMIN_BODIES["fly.destroy"], target: "volume", volumeId: "v9" });
      expect(fly.destroyVolume).toHaveBeenCalledWith("fly-write-fake", "client-app", "v9");
      const targets = m(logAuditEvent).mock.calls.map((c) => c[0].targetId);
      expect(targets).toEqual(["client-app", "m9", "v9"]);
    });

    it("requires machineId / volumeId for those targets", async () => {
      const a = await call({ ...ADMIN_BODIES["fly.destroy"], target: "machine" });
      expect(a.status).toBe(400);
      expect(await a.json()).toEqual({ error: "machineId required" });
      const b = await call({ ...ADMIN_BODIES["fly.destroy"], target: "volume" });
      expect(b.status).toBe(400);
      expect(await b.json()).toEqual({ error: "volumeId required" });
      expectNoWrites();
    });

    it("403s on a protected platform app even for Admin", async () => {
      const res = await call({ ...ADMIN_BODIES["fly.destroy"], app: "dali-api-prod" });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("protected platform resource");
      expectNoWrites();
    });

    it("403s on an operator-configured protected app", async () => {
      process.env.INFRA_PROTECTED_FLY_APPS = "keep-me, other";
      const res = await call({ ...ADMIN_BODIES["fly.destroy"], app: "keep-me" });
      expect(res.status).toBe(403);
      expect(fly.destroyApp).not.toHaveBeenCalled();
    });

    it("400s without a Fly write token", async () => {
      m(getProjectInfraCreds).mockResolvedValue({ flyWriteToken: null });
      const res = await call(ADMIN_BODIES["fly.destroy"]);
      expect(res.status).toBe(400);
      expect(fly.destroyApp).not.toHaveBeenCalled();
    });
  });

  describe("neon admin intents", () => {
    beforeEach(() => m(isAdmin).mockResolvedValue(true));

    it("neon.quota sets the quota and audits it", async () => {
      await call(ADMIN_BODIES["neon.quota"]);
      expect(neon.setProjectQuota).toHaveBeenCalledWith("n1", { active_time_seconds: 10 });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "infra.neon.quota",
          targetId: "n1",
          metadata: { projectId: "p1", active_time_seconds: 10 },
        }),
      );
    });

    it("blocks quota, project delete and branch delete on a protected Neon project", async () => {
      process.env.INFRA_PROTECTED_NEON_PROJECTS = "n1";
      for (const intent of ["neon.quota", "neon.project.delete", "neon.branch.delete"]) {
        const res = await call(ADMIN_BODIES[intent]);
        expect(res.status).toBe(403);
      }
      expectNoWrites();
    });

    it("neon.project.create needs an org id", async () => {
      m(getProjectInfraCreds).mockResolvedValue({ flyWriteToken: null, neonOrgId: null });
      const res = await call(ADMIN_BODIES["neon.project.create"]);
      expect(res.status).toBe(400);
      expect(neon.createProject).not.toHaveBeenCalled();
    });

    it("neon.project.create records the new project id on the DALI project", async () => {
      const res = await call(ADMIN_BODIES["neon.project.create"]);
      expect(await res.json()).toEqual({ ok: true, neonProjectId: "new-n" });
      expect(neon.createProject).toHaveBeenCalledWith("org-1", "db");
      expect(neon.pollOperations).toHaveBeenCalledWith("new-n", ["op4"]);
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: "p1" },
        data: { neonProjectIds: { push: "new-n" } },
      });
    });

    it("neon.project.create skips the project update when Neon returns no id", async () => {
      m(neon.createProject).mockResolvedValue({ projectId: null, operations: [] });
      await call(ADMIN_BODIES["neon.project.create"]);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it("neon.project.delete and neon.branch.delete call Neon and audit as destroy", async () => {
      await call(ADMIN_BODIES["neon.project.delete"]);
      expect(neon.deleteProject).toHaveBeenCalledWith("n1");
      await call(ADMIN_BODIES["neon.branch.delete"]);
      expect(neon.deleteBranch).toHaveBeenCalledWith("n1", "b1");
      expect(neon.pollOperations).toHaveBeenCalledWith("n1", ["op3"]);
      expect(m(logAuditEvent).mock.calls.map((c) => [c[0].action, c[0].targetId, c[0].metadata.kind])).toEqual([
        ["infra.neon.destroy", "n1", "project"],
        ["infra.neon.destroy", "b1", "branch"],
      ]);
    });
  });

  describe("reap", () => {
    beforeEach(() => m(isAdmin).mockResolvedValue(true));

    it("fly-app destroys the app and requires app", async () => {
      await call(ADMIN_BODIES.reap);
      expect(fly.destroyApp).toHaveBeenCalledWith("fly-write-fake", "client-app");
      const res = await call({ intent: "reap", projectId: "p1", kind: "fly-app" });
      expect(await res.json()).toEqual({ error: "app required" });
    });

    it("fly-app refuses a protected app", async () => {
      const res = await call({ ...ADMIN_BODIES.reap, app: "dali-api-staging" });
      expect(res.status).toBe(403);
      expect(fly.destroyApp).not.toHaveBeenCalled();
    });

    it("neon-branch deletes the branch and requires both ids", async () => {
      await call({ intent: "reap", projectId: "p1", kind: "neon-branch", neonProjectId: "n1", branchId: "b1" });
      expect(neon.deleteBranch).toHaveBeenCalledWith("n1", "b1");
      const res = await call({ intent: "reap", projectId: "p1", kind: "neon-branch", neonProjectId: "n1" });
      expect(res.status).toBe(400);
    });

    it("neon-endpoint suspends (never deletes) and requires both ids", async () => {
      await call({ intent: "reap", projectId: "p1", kind: "neon-endpoint", neonProjectId: "n1", endpointId: "e1" });
      expect(neon.endpointAction).toHaveBeenCalledWith("n1", "e1", "suspend");
      const res = await call({ intent: "reap", projectId: "p1", kind: "neon-endpoint", endpointId: "e1" });
      expect(res.status).toBe(400);
    });

    it("refuses protected Neon projects and audits reaps with their kind", async () => {
      process.env.INFRA_PROTECTED_NEON_PROJECTS = "n1";
      const res = await call({ intent: "reap", projectId: "p1", kind: "neon-branch", neonProjectId: "n1", branchId: "b1" });
      expect(res.status).toBe(403);
      expect(neon.deleteBranch).not.toHaveBeenCalled();
      delete process.env.INFRA_PROTECTED_NEON_PROJECTS;
      await call({ intent: "reap", projectId: "p1", kind: "neon-branch", neonProjectId: "n1", branchId: "b1" });
      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "infra.reap",
          targetId: "b1",
          metadata: { projectId: "p1", kind: "neon-branch" },
        }),
      );
    });
  });

  it("returns 502 with the message when the provider call fails, without auditing", async () => {
    m(fly.machineAction).mockRejectedValue(new Error("fly exploded"));
    const res = await call(CORE_BODIES["fly.machine"]);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "fly exploded" });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
