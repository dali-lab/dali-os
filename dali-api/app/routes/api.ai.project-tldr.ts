// POST /api/ai/project-tldr — generates (and caches) the one-or-two-sentence
// AI summary of a project's work status shown under the Progress-tab status
// bar. Requires an authenticated member session, the `project-tldr-ai` flag,
// and a configured AI provider (503 otherwise). The summary is cached on the
// Project row and shared across viewers: we only call the model when the work
// has changed (the facts fingerprint no longer matches) or the cache is older
// than the TTL — or when the caller passes force:true (the Refresh button).
//
// NEVER log the API key, JWT, cookies, or full project content.

import type { Route } from "./+types/api.ai.project-tldr";
import Anthropic from "@anthropic-ai/sdk";
import { requireAuth } from "~/lib/auth";
import { generateShortText } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { getUserRoles } from "~/lib/roles";
import { checkRateLimit } from "~/lib/rate-limit";
import { prisma } from "~/lib/db";
import {
  computeProjectStatus,
  factsFingerprint,
  buildTldrDetail,
  type ProjectStatusFacts,
  type ProjectWorkStatus,
  type TldrTaskInput,
  type TldrDetail,
} from "~/projects/lib/project-status";
import type { TaskStatus, Priority } from "~/projects/lib/task-board";

// ── Contract ────────────────────────────────────────────────────────────────

export interface ProjectTldrResponse {
  tldr: string | null;
  generatedAt: string | null;
}

export interface ProjectTldrDisabledResponse {
  aiEnabled: false;
}

// ── Rate limits (per user), mirroring /api/ai/doc ─────────────────────────────

const AI_BURST_MAX = 10;
const AI_BURST_WINDOW_MS = 60_000;
const AI_DAILY_MAX = 200;

// A cached summary older than this is regenerated on next view even when the
// work hasn't changed — keeps relative phrasing ("ends in 5 days") from drifting.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Match the loader's task bound so the summary reflects the same work the board
// shows (see projects.$id.tsx).
const TASK_TAKE = 1000;

// The reader already sees the raw counts as chips directly above this text, so
// the summary must NOT restate them — it earns its place only by interpreting:
// what to focus on first, why, and the obvious next step. Naming specific tasks
// is what makes it concrete rather than a paraphrase of the chips.
const SYSTEM_PROMPT = `You are a project-health analyst for a software lab's project board. \
The reader ALREADY sees the raw counts (done/total, overdue, unscheduled, in review, active sprint) as labels directly above your text. \
Do NOT restate those numbers or list the categories back — that is wasted space. \
Instead, in ONE or TWO sentences, give a judgment the counts don't: name the single most important thing to address and WHY, cite the specific task(s) involved when it sharpens the point, and suggest the obvious next step if there is one. \
Weigh it like a lead would: overdue high-priority work and running with no sprint plan matter more than a large-but-moving backlog; a few stalled tasks can be the real story. \
If the project is genuinely healthy, say so in one short sentence instead of inventing problems. \
Plain text only: no preamble, no markdown, no bullet points, no headings.`;

function secondsToUtcMidnight(): number {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// Feeds the model specifics (named tasks, priority mix, team size, whether a
// sprint is running) so it has real material to interpret — the counts alone
// only let it paraphrase the chips.
function factsToPrompt(name: string, f: ProjectStatusFacts, d: TldrDetail): string {
  const sprint = f.activeSprint
    ? `${f.activeSprint.label}, ${
        f.activeSprint.daysRemaining >= 0
          ? `${f.activeSprint.daysRemaining} day(s) left`
          : `${-f.activeSprint.daysRemaining} day(s) overdue`
      }`
    : "NONE running";
  const overdue = d.overdue.length
    ? d.overdue
        .map((o) => `"${o.title}" [${o.priority}, ${o.daysOver}d overdue]`)
        .join("; ")
    : "none";
  const stale = d.stale.length
    ? d.stale.map((s) => `"${s.title}" [${s.daysStale}d untouched]`).join("; ")
    : "none";
  const inReview = d.inReview.length
    ? d.inReview.map((t) => `"${t}"`).join("; ")
    : "none";
  return [
    `Project "${name}" — status ${f.projectStatus}.`,
    `Progress: ${f.doneTasks} of ${f.totalTasks} tasks done.`,
    `Active sprint: ${sprint}.`,
    `Distinct assignees (rough team size): ${d.teamSize}.`,
    `Open priority mix: ${d.urgentOpen} urgent, ${d.highOpen} high.`,
    `Overdue tasks (${f.overdue}): ${overdue}.`,
    `Unscheduled in-motion tasks with no sprint: ${f.unscheduled} (${d.unscheduledHighPriority} of them high/urgent).`,
    `In review (${f.inReview}): ${inReview}.`,
    `Stalled 14d+ (${f.stale}): ${stale}.`,
  ].join("\n");
}

// ── Route action ──────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // ── Burst gate (cheapest — before body/DB/model work) ─────────────────────
  const burstLimited = checkRateLimit(
    request,
    { max: AI_BURST_MAX, windowMs: AI_BURST_WINDOW_MS },
    `ai-tldr:${auth.user.sub}`,
  );
  if (burstLimited) {
    const retryAfter = burstLimited.headers.get("Retry-After") ?? "60";
    return Response.json(
      { error: `You're sending AI requests too quickly — try again in ${retryAfter}s.` },
      { status: 429, headers: { "Retry-After": retryAfter } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const projectId = typeof b.projectId === "string" ? b.projectId : "";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }
  const force = b.force === true;

  // ── Feature-flag gate (defence in depth; the client also checks it) ───────
  const roles = await getUserRoles(auth.user.sub, request);
  const flagOn = await isFeatureEnabled("project-tldr-ai", auth.user.sub, roles, request);
  if (!flagOn) {
    return Response.json({ error: "Not available" }, { status: 403 });
  }

  // ── Project (any authenticated member may view a project, matching the
  // projects.$id loader) + the work rows the summary is built from. ─────────
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      status: true,
      aiTldr: true,
      aiTldrGeneratedAt: true,
      aiTldrInputHash: true,
      tasks: {
        where: { archivedAt: null },
        take: TASK_TAKE,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          startsAt: true,
          dueAt: true,
          activityAt: true,
          assignees: { select: { userId: true } },
        },
      },
      projectTerms: {
        select: {
          term: { select: { code: true, startDate: true, endDate: true, sortKey: true } },
        },
      },
    },
  });
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }

  const now = new Date();
  const tasks: TldrTaskInput[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status as TaskStatus,
    priority: t.priority as Priority,
    startsAt: t.startsAt,
    dueAt: t.dueAt,
    activityAt: t.activityAt,
    assigneeIds: t.assignees.map((a) => a.userId),
  }));
  // Term spans (oldest first) anchor the computed sprint grid the current-sprint
  // fact is read off — the same grid the timeline and board use.
  const terms = project.projectTerms
    .map((pt) => pt.term)
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((t) => ({
      code: t.code,
      startsAt: t.startDate.toISOString(),
      endsAt: t.endDate.toISOString(),
    }));
  const facts = computeProjectStatus(
    { projectStatus: project.status as ProjectWorkStatus, tasks, terms },
    now,
  );
  const detail = buildTldrDetail(tasks, now);

  // Nothing to summarize — return null rather than spend a model call.
  if (!facts.hasWork) {
    return Response.json({ tldr: null, generatedAt: null } satisfies ProjectTldrResponse);
  }

  const fingerprint = factsFingerprint(facts);

  // ── Cache short-circuit ───────────────────────────────────────────────────
  const fresh =
    project.aiTldrGeneratedAt != null &&
    Date.now() - project.aiTldrGeneratedAt.getTime() < CACHE_TTL_MS;
  if (!force && project.aiTldr && project.aiTldrInputHash === fingerprint && fresh) {
    return Response.json({
      tldr: project.aiTldr,
      generatedAt: project.aiTldrGeneratedAt!.toISOString(),
    } satisfies ProjectTldrResponse);
  }

  // ── Daily quota — last gate before the model call ─────────────────────────
  const day = new Date().toISOString().slice(0, 10);
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId: auth.user.sub, day } },
    create: { userId: auth.user.sub, day, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (usage.count > AI_DAILY_MAX) {
    const retryAfter = secondsToUtcMidnight();
    return Response.json(
      { error: `You've reached today's AI limit (${AI_DAILY_MAX} requests). It resets at midnight UTC.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // ── Generate + cache ──────────────────────────────────────────────────────
  try {
    const result = await generateShortText({
      system: SYSTEM_PROMPT,
      prompt: factsToPrompt(project.name, facts, detail),
      maxTokens: 400,
    });
    if (!result) {
      return Response.json({ aiEnabled: false } satisfies ProjectTldrDisabledResponse, {
        status: 503,
      });
    }

    const generatedAt = new Date();
    await prisma.project.update({
      where: { id: project.id },
      data: {
        aiTldr: result.text,
        aiTldrGeneratedAt: generatedAt,
        aiTldrInputHash: fingerprint,
      },
    });
    await recordTokenUsage(auth.user.sub, day, result.inputTokens, result.outputTokens);

    return Response.json({
      tldr: result.text,
      generatedAt: generatedAt.toISOString(),
    } satisfies ProjectTldrResponse);
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: "AI service error" }, { status: 502 });
    }
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
