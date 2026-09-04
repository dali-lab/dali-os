// Infrastructure dashboard write actions. All Fly/Neon mutations funnel through
// here. Gating: reads + safe reversible actions are Core; provisioning, quotas,
// and destructive actions are Admin. The protected-resource allowlist
// (guard.server.ts) hard-blocks the platform's own infra regardless of role.
// Every action is audited with non-secret metadata.

import type { Route } from "./+types/api.infra.action";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { getInfraProjectCreds } from "~/lib/infra/registry.server";
import {
  assertFlyAppMutable,
  assertNeonProjectMutable,
  ProtectedResourceError,
} from "~/lib/infra/guard.server";
import * as fly from "~/lib/infra/fly.server";
import * as neon from "~/lib/infra/neon.server";

const Body = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("fly.machine"),
    projectKey: z.string(),
    app: z.string(),
    machineId: z.string(),
    kind: z.enum(["start", "stop", "restart", "suspend"]),
  }),
  z.object({
    intent: z.literal("fly.scale"),
    projectKey: z.string(),
    app: z.string(),
    machineId: z.string(),
    cpuKind: z.enum(["shared", "performance"]),
    cpus: z.number().int().min(1).max(16),
    memoryMb: z.number().int().min(256).max(262144),
  }),
  z.object({
    intent: z.literal("fly.destroy"),
    projectKey: z.string(),
    target: z.enum(["machine", "volume", "app"]),
    app: z.string(),
    machineId: z.string().optional(),
    volumeId: z.string().optional(),
  }),
  z.object({
    intent: z.literal("neon.endpoint"),
    projectKey: z.string(),
    projectId: z.string(),
    endpointId: z.string(),
    kind: z.enum(["suspend", "restart", "start"]),
  }),
  z.object({
    intent: z.literal("neon.autoscale"),
    projectKey: z.string(),
    projectId: z.string(),
    endpointId: z.string(),
    minCu: z.number().min(0.25).max(64).optional(),
    maxCu: z.number().min(0.25).max(64).optional(),
    suspendTimeoutSeconds: z.number().int().min(-1).max(604800).optional(),
  }),
  z.object({
    intent: z.literal("neon.quota"),
    projectKey: z.string(),
    projectId: z.string(),
    quota: z
      .object({
        active_time_seconds: z.number().int().min(0).optional(),
        compute_time_seconds: z.number().int().min(0).optional(),
        written_data_bytes: z.number().int().min(0).optional(),
        data_transfer_bytes: z.number().int().min(0).optional(),
        logical_size_bytes: z.number().int().min(0).optional(),
      })
      .refine((q) => Object.keys(q).length > 0, { message: "No quota fields" }),
  }),
  z.object({
    intent: z.literal("neon.project.create"),
    projectKey: z.string(),
    name: z.string().min(1).max(128),
  }),
  z.object({
    intent: z.literal("neon.project.delete"),
    projectKey: z.string(),
    projectId: z.string(),
  }),
  z.object({
    intent: z.literal("neon.branch.delete"),
    projectKey: z.string(),
    projectId: z.string(),
    branchId: z.string(),
  }),
  z.object({
    intent: z.literal("reap"),
    projectKey: z.string(),
    kind: z.enum(["fly-app", "neon-branch", "neon-endpoint"]),
    app: z.string().optional(),
    projectId: z.string().optional(),
    branchId: z.string().optional(),
    endpointId: z.string().optional(),
  }),
]);

type Parsed = z.infer<typeof Body>;

const ADMIN_INTENTS = new Set<Parsed["intent"]>([
  "fly.destroy",
  "neon.quota",
  "neon.project.create",
  "neon.project.delete",
  "neon.branch.delete",
  "reap",
]);

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const parsed = await parseJson(request, Body);
  if (parsed instanceof Response) return parsed;

  if (ADMIN_INTENTS.has(parsed.intent) && !(await isAdmin(auth.user.sub))) {
    return forbidden(request);
  }

  const creds = await getInfraProjectCreds(parsed.projectKey);
  if (!creds) return Response.json({ error: "Unknown project" }, { status: 404 });

  const flyWrite = creds.flyWriteToken;
  function needFlyWrite(): string | Response {
    if (!flyWrite) {
      return Response.json(
        { error: "No Fly write token configured for this project" },
        { status: 400 },
      );
    }
    return flyWrite;
  }

  try {
    switch (parsed.intent) {
      case "fly.machine": {
        const tok = needFlyWrite();
        if (tok instanceof Response) return tok;
        await fly.machineAction(tok, parsed.app, parsed.machineId, parsed.kind);
        await audit(auth.user.sub, "infra.fly.action", parsed.machineId, request, {
          projectKey: parsed.projectKey,
          app: parsed.app,
          kind: parsed.kind,
        });
        return Response.json({ ok: true });
      }
      case "fly.scale": {
        const tok = needFlyWrite();
        if (tok instanceof Response) return tok;
        await fly.scaleMachine(tok, parsed.app, parsed.machineId, {
          cpu_kind: parsed.cpuKind,
          cpus: parsed.cpus,
          memory_mb: parsed.memoryMb,
        });
        await audit(auth.user.sub, "infra.fly.action", parsed.machineId, request, {
          projectKey: parsed.projectKey,
          app: parsed.app,
          kind: "scale",
          cpuKind: parsed.cpuKind,
          cpus: parsed.cpus,
          memoryMb: parsed.memoryMb,
        });
        return Response.json({ ok: true });
      }
      case "fly.destroy": {
        const tok = needFlyWrite();
        if (tok instanceof Response) return tok;
        assertFlyAppMutable(parsed.app);
        if (parsed.target === "app") {
          await fly.destroyApp(tok, parsed.app);
        } else if (parsed.target === "machine") {
          if (!parsed.machineId) return badReq("machineId required");
          await fly.destroyMachine(tok, parsed.app, parsed.machineId);
        } else {
          if (!parsed.volumeId) return badReq("volumeId required");
          await fly.destroyVolume(tok, parsed.app, parsed.volumeId);
        }
        await audit(auth.user.sub, "infra.fly.destroy", parsed.machineId ?? parsed.volumeId ?? parsed.app, request, {
          projectKey: parsed.projectKey,
          app: parsed.app,
          target: parsed.target,
        });
        return Response.json({ ok: true });
      }
      case "neon.endpoint": {
        const ops = await neon.endpointAction(parsed.projectId, parsed.endpointId, parsed.kind);
        await neon.pollOperations(parsed.projectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.endpoint", parsed.endpointId, request, {
          projectKey: parsed.projectKey,
          projectId: parsed.projectId,
          kind: parsed.kind,
        });
        return Response.json({ ok: true });
      }
      case "neon.autoscale": {
        const patch: {
          autoscaling_limit_min_cu?: number;
          autoscaling_limit_max_cu?: number;
          suspend_timeout_seconds?: number;
        } = {};
        if (parsed.minCu !== undefined) patch.autoscaling_limit_min_cu = parsed.minCu;
        if (parsed.maxCu !== undefined) patch.autoscaling_limit_max_cu = parsed.maxCu;
        if (parsed.suspendTimeoutSeconds !== undefined)
          patch.suspend_timeout_seconds = parsed.suspendTimeoutSeconds;
        if (Object.keys(patch).length === 0) return badReq("Nothing to update");
        const ops = await neon.updateEndpoint(parsed.projectId, parsed.endpointId, patch);
        await neon.pollOperations(parsed.projectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.endpoint", parsed.endpointId, request, {
          projectKey: parsed.projectKey,
          projectId: parsed.projectId,
          kind: "autoscale",
          ...patch,
        });
        return Response.json({ ok: true });
      }
      case "neon.quota": {
        assertNeonProjectMutable(parsed.projectId);
        await neon.setProjectQuota(parsed.projectId, parsed.quota);
        await audit(auth.user.sub, "infra.neon.quota", parsed.projectId, request, {
          projectKey: parsed.projectKey,
          ...parsed.quota,
        });
        return Response.json({ ok: true });
      }
      case "neon.project.create": {
        if (!creds.neonOrgId) return badReq("No Neon org id configured for this project");
        const { projectId, operations } = await neon.createProject(creds.neonOrgId, parsed.name);
        if (projectId) await neon.pollOperations(projectId, operations).catch(() => {});
        await audit(auth.user.sub, "infra.neon.project.create", projectId, request, {
          projectKey: parsed.projectKey,
          name: parsed.name,
        });
        return Response.json({ ok: true, projectId });
      }
      case "neon.project.delete": {
        assertNeonProjectMutable(parsed.projectId);
        await neon.deleteProject(parsed.projectId);
        await audit(auth.user.sub, "infra.neon.destroy", parsed.projectId, request, {
          projectKey: parsed.projectKey,
          kind: "project",
        });
        return Response.json({ ok: true });
      }
      case "neon.branch.delete": {
        assertNeonProjectMutable(parsed.projectId);
        const ops = await neon.deleteBranch(parsed.projectId, parsed.branchId);
        await neon.pollOperations(parsed.projectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.destroy", parsed.branchId, request, {
          projectKey: parsed.projectKey,
          kind: "branch",
          projectId: parsed.projectId,
        });
        return Response.json({ ok: true });
      }
      case "reap": {
        if (parsed.kind === "fly-app") {
          const tok = needFlyWrite();
          if (tok instanceof Response) return tok;
          if (!parsed.app) return badReq("app required");
          assertFlyAppMutable(parsed.app);
          await fly.destroyApp(tok, parsed.app);
        } else if (parsed.kind === "neon-branch") {
          if (!parsed.projectId || !parsed.branchId) return badReq("projectId + branchId required");
          assertNeonProjectMutable(parsed.projectId);
          const ops = await neon.deleteBranch(parsed.projectId, parsed.branchId);
          await neon.pollOperations(parsed.projectId, ops).catch(() => {});
        } else {
          if (!parsed.projectId || !parsed.endpointId)
            return badReq("projectId + endpointId required");
          assertNeonProjectMutable(parsed.projectId);
          await neon.endpointAction(parsed.projectId, parsed.endpointId, "suspend");
        }
        await audit(auth.user.sub, "infra.reap", parsed.app ?? parsed.branchId ?? parsed.endpointId, request, {
          projectKey: parsed.projectKey,
          kind: parsed.kind,
        });
        return Response.json({ ok: true });
      }
    }
  } catch (err) {
    if (err instanceof ProtectedResourceError) {
      return Response.json({ error: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

function badReq(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

async function audit(
  userId: string,
  actionName: Parameters<typeof logAuditEvent>[0]["action"],
  targetId: string | null | undefined,
  request: Request,
  metadata: Record<string, unknown>,
): Promise<void> {
  await logAuditEvent({
    action: actionName,
    userId,
    targetId: targetId ?? null,
    metadata: metadata as Parameters<typeof logAuditEvent>[0]["metadata"],
    request,
  });
}
