// Infrastructure dashboard write actions. All Fly/Neon mutations funnel through
// here. Gating: reads + safe reversible actions are Core; provisioning, quotas,
// and destructive actions are Admin. The protected-resource allowlist
// (guard.server.ts) hard-blocks the platform's own infra regardless of role.
// Every action is audited with non-secret metadata.
//
// `projectId` = the DALI Project (carries the infra config/tokens); for Neon
// actions the target Neon project is a separate `neonProjectId`.

import type { Route } from "./+types/api.infra.action";
import { z } from "zod";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore, isAdmin } from "~/lib/roles";
import { parseJson } from "~/lib/validate";
import { logAuditEvent } from "~/lib/audit";
import { getProjectInfraCreds } from "~/lib/infra/project-infra.server";
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
    projectId: z.string(),
    app: z.string(),
    machineId: z.string(),
    kind: z.enum(["start", "stop", "restart", "suspend"]),
  }),
  z.object({
    intent: z.literal("fly.scale"),
    projectId: z.string(),
    app: z.string(),
    machineId: z.string(),
    cpuKind: z.enum(["shared", "performance"]),
    cpus: z.number().int().min(1).max(16),
    memoryMb: z.number().int().min(256).max(262144),
  }),
  z.object({
    intent: z.literal("fly.destroy"),
    projectId: z.string(),
    target: z.enum(["machine", "volume", "app"]),
    app: z.string(),
    machineId: z.string().optional(),
    volumeId: z.string().optional(),
  }),
  z.object({
    intent: z.literal("neon.endpoint"),
    projectId: z.string(),
    neonProjectId: z.string(),
    endpointId: z.string(),
    kind: z.enum(["suspend", "restart", "start"]),
  }),
  z.object({
    intent: z.literal("neon.autoscale"),
    projectId: z.string(),
    neonProjectId: z.string(),
    endpointId: z.string(),
    minCu: z.number().min(0.25).max(64).optional(),
    maxCu: z.number().min(0.25).max(64).optional(),
    suspendTimeoutSeconds: z.number().int().min(-1).max(604800).optional(),
  }),
  z.object({
    intent: z.literal("neon.quota"),
    projectId: z.string(),
    neonProjectId: z.string(),
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
    projectId: z.string(),
    name: z.string().min(1).max(128),
  }),
  z.object({
    intent: z.literal("neon.project.delete"),
    projectId: z.string(),
    neonProjectId: z.string(),
  }),
  z.object({
    intent: z.literal("neon.branch.delete"),
    projectId: z.string(),
    neonProjectId: z.string(),
    branchId: z.string(),
  }),
  z.object({
    intent: z.literal("reap"),
    projectId: z.string(),
    kind: z.enum(["fly-app", "neon-branch", "neon-endpoint"]),
    app: z.string().optional(),
    neonProjectId: z.string().optional(),
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

  const creds = await getProjectInfraCreds(parsed.projectId);
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
          projectId: parsed.projectId,
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
          projectId: parsed.projectId,
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
        await audit(
          auth.user.sub,
          "infra.fly.destroy",
          parsed.machineId ?? parsed.volumeId ?? parsed.app,
          request,
          { projectId: parsed.projectId, app: parsed.app, target: parsed.target },
        );
        return Response.json({ ok: true });
      }
      case "neon.endpoint": {
        const ops = await neon.endpointAction(parsed.neonProjectId, parsed.endpointId, parsed.kind);
        await neon.pollOperations(parsed.neonProjectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.endpoint", parsed.endpointId, request, {
          projectId: parsed.projectId,
          neonProjectId: parsed.neonProjectId,
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
        const ops = await neon.updateEndpoint(parsed.neonProjectId, parsed.endpointId, patch);
        await neon.pollOperations(parsed.neonProjectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.endpoint", parsed.endpointId, request, {
          projectId: parsed.projectId,
          neonProjectId: parsed.neonProjectId,
          kind: "autoscale",
          ...patch,
        });
        return Response.json({ ok: true });
      }
      case "neon.quota": {
        assertNeonProjectMutable(parsed.neonProjectId);
        await neon.setProjectQuota(parsed.neonProjectId, parsed.quota);
        await audit(auth.user.sub, "infra.neon.quota", parsed.neonProjectId, request, {
          projectId: parsed.projectId,
          ...parsed.quota,
        });
        return Response.json({ ok: true });
      }
      case "neon.project.create": {
        if (!creds.neonOrgId) return badReq("No Neon org id configured for this project");
        const { projectId, operations } = await neon.createProject(creds.neonOrgId, parsed.name);
        if (projectId) await neon.pollOperations(projectId, operations).catch(() => {});
        await audit(auth.user.sub, "infra.neon.project.create", projectId, request, {
          projectId: parsed.projectId,
          name: parsed.name,
        });
        return Response.json({ ok: true, neonProjectId: projectId });
      }
      case "neon.project.delete": {
        assertNeonProjectMutable(parsed.neonProjectId);
        await neon.deleteProject(parsed.neonProjectId);
        await audit(auth.user.sub, "infra.neon.destroy", parsed.neonProjectId, request, {
          projectId: parsed.projectId,
          kind: "project",
        });
        return Response.json({ ok: true });
      }
      case "neon.branch.delete": {
        assertNeonProjectMutable(parsed.neonProjectId);
        const ops = await neon.deleteBranch(parsed.neonProjectId, parsed.branchId);
        await neon.pollOperations(parsed.neonProjectId, ops).catch(() => {});
        await audit(auth.user.sub, "infra.neon.destroy", parsed.branchId, request, {
          projectId: parsed.projectId,
          kind: "branch",
          neonProjectId: parsed.neonProjectId,
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
          if (!parsed.neonProjectId || !parsed.branchId)
            return badReq("neonProjectId + branchId required");
          assertNeonProjectMutable(parsed.neonProjectId);
          const ops = await neon.deleteBranch(parsed.neonProjectId, parsed.branchId);
          await neon.pollOperations(parsed.neonProjectId, ops).catch(() => {});
        } else {
          if (!parsed.neonProjectId || !parsed.endpointId)
            return badReq("neonProjectId + endpointId required");
          assertNeonProjectMutable(parsed.neonProjectId);
          await neon.endpointAction(parsed.neonProjectId, parsed.endpointId, "suspend");
        }
        await audit(
          auth.user.sub,
          "infra.reap",
          parsed.app ?? parsed.branchId ?? parsed.endpointId,
          request,
          { projectId: parsed.projectId, kind: parsed.kind },
        );
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
