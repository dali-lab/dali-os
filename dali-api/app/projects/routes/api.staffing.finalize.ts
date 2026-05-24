import type { Route } from "./+types/api.staffing.finalize";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { canManageStaffing } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { postMessage } from "~/slack/lib/slack-client";
import { logAuditEvent } from "~/lib/audit";

// POST /api/staffing/finalize
//
// Runs a selected subset of "finalize a project" automations for one project
// within one staffing cycle. Each automation reports its own outcome so the
// modal can show per-step results. Idempotent — safe to re-run.
//
// Automations:
//   - assignments: Proposed StaffingAssignment rows for this project+cycle →
//     Confirmed, and upsert canonical ProjectAssignment + DomainEligibility.
//   - slack:       post the confirmed roster to STAFFING_SLACK_CHANNEL.
//   - gmail:       STUB — no Google Admin SDK wired up yet.
//   - github:      STUB — GitHub App lacks org-team scope.

const AUTOMATIONS = ["assignments", "slack", "gmail", "github"] as const;
type Automation = (typeof AUTOMATIONS)[number];

type StepResult = { status: "ok" | "skipped" | "error"; message: string };

type Body = { cycleId: string; projectId: string; automations: string[] };

function isBody(x: unknown): x is Body {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.cycleId === "string" &&
    typeof o.projectId === "string" &&
    Array.isArray(o.automations) &&
    o.automations.every((a) => typeof a === "string")
  );
}

export async function action({ request }: Route.ActionArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);

  if (request.method !== "POST") {
    return withCors(request, Response.json({ error: "Method not allowed" }, { status: 405 }));
  }
  if (!(await canManageStaffing(auth.user.sub))) {
    return withCors(request, Response.json({ error: "Forbidden" }, { status: 403 }));
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(request, Response.json({ error: "Invalid JSON" }, { status: 400 }));
  }
  if (!isBody(body)) {
    return withCors(request, Response.json({ error: "Invalid body" }, { status: 400 }));
  }

  const selected = new Set<Automation>(
    body.automations.filter((a): a is Automation =>
      (AUTOMATIONS as readonly string[]).includes(a),
    ),
  );
  if (selected.size === 0) {
    return withCors(request, Response.json({ error: "No automations selected" }, { status: 400 }));
  }

  const cycle = await prisma.staffingCycle.findUnique({
    where: { id: body.cycleId },
    select: { id: true, termId: true, name: true },
  });
  if (!cycle) {
    return withCors(request, Response.json({ error: "Cycle not found" }, { status: 404 }));
  }
  const project = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true, name: true },
  });
  if (!project) {
    return withCors(request, Response.json({ error: "Project not found" }, { status: 404 }));
  }

  const results: Record<Automation, StepResult> = {} as Record<Automation, StepResult>;

  // ── assignments ────────────────────────────────────────────────────────────
  // Run this first; the Slack step reports the roster it produced.
  let confirmedCount = 0;
  if (selected.has("assignments")) {
    try {
      const proposed = await prisma.staffingAssignment.findMany({
        where: {
          staffingCycleId: cycle.id,
          projectId: project.id,
          status: { in: ["Proposed", "Confirmed"] },
        },
        select: { id: true, userId: true, domainId: true, level: true, status: true },
      });

      for (const a of proposed) {
        await prisma.$transaction(async (tx) => {
          if (a.status !== "Confirmed") {
            await tx.staffingAssignment.update({
              where: { id: a.id },
              data: { status: "Confirmed" },
            });
          }
          await tx.projectAssignment.upsert({
            where: {
              userId_projectId_termId_domainId: {
                userId: a.userId,
                projectId: project.id,
                termId: cycle.termId,
                domainId: a.domainId,
              },
            },
            update: { level: a.level },
            create: {
              userId: a.userId,
              projectId: project.id,
              termId: cycle.termId,
              domainId: a.domainId,
              level: a.level,
            },
          });
          // Eligibility is monotonic (only goes up); but the staffing lead
          // is the authority here, so mirror the assigned level.
          await tx.domainEligibility.upsert({
            where: { userId_domainId: { userId: a.userId, domainId: a.domainId } },
            update: { level: a.level, promotedBy: auth.user.sub },
            create: {
              userId: a.userId,
              domainId: a.domainId,
              level: a.level,
              promotedBy: auth.user.sub,
            },
          });
        });
        confirmedCount++;
      }
      results.assignments = {
        status: "ok",
        message:
          confirmedCount === 0
            ? "No proposed assignments for this project."
            : `Confirmed ${confirmedCount} assignment${confirmedCount === 1 ? "" : "s"} → ProjectAssignment.`,
      };
    } catch (err) {
      results.assignments = { status: "error", message: errMsg(err) };
    }
  }

  // ── slack ──────────────────────────────────────────────────────────────────
  if (selected.has("slack")) {
    const channel = process.env.STAFFING_SLACK_CHANNEL;
    if (!channel) {
      results.slack = {
        status: "skipped",
        message: "STAFFING_SLACK_CHANNEL not set.",
      };
    } else {
      try {
        // Roster reflects confirmed rows regardless of whether the
        // assignments step ran this invocation.
        const roster = await prisma.staffingAssignment.findMany({
          where: {
            staffingCycleId: cycle.id,
            projectId: project.id,
            status: "Confirmed",
          },
          select: { user: { select: { firstName: true, lastName: true } }, level: true },
        });
        const lines = roster
          .map((r) => `• ${r.user.firstName} ${r.user.lastName} (${r.level})`)
          .join("\n");
        const text =
          `*${project.name}* staffed for ${cycle.name}\n` +
          (roster.length > 0 ? lines : "_No confirmed members yet._");
        await postMessage(channel, text);
        results.slack = { status: "ok", message: `Posted roster (${roster.length}) to Slack.` };
      } catch (err) {
        results.slack = { status: "error", message: errMsg(err) };
      }
    }
  }

  // ── gmail (stub) ───────────────────────────────────────────────────────────
  if (selected.has("gmail")) {
    results.gmail = {
      status: "skipped",
      message: "Google Workspace account provisioning is not configured.",
    };
  }

  // ── github (stub) ──────────────────────────────────────────────────────────
  if (selected.has("github")) {
    results.github = {
      status: "skipped",
      message: "GitHub team provisioning is not configured.",
    };
  }

  await logAuditEvent({
    action: "staffing.finalize",
    userId: auth.user.sub,
    targetId: project.id,
    metadata: {
      cycleId: cycle.id,
      automations: Array.from(selected),
      confirmedCount,
      results,
    },
    request,
  });

  return withCors(request, Response.json({ results }));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
