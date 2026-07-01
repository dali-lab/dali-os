import type { Route } from "./+types/api.staffing.sync-teams";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing, currentTerm } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { slackErrorMessage } from "~/slack/lib/slack-client";
import { logAuditEvent } from "~/lib/audit";
import { syncProjectTeam, type ProjectTeamSyncReport } from "~/projects/lib/github-team-sync";

// POST /api/staffing/sync-teams
//
// Add-only GitHub team sync for EVERY project staffed this term: ensure each
// project's org team, add its rostered members (by githubUsername), and grant
// the team push on each of its repos. Idempotent — safe to re-run. Never removes
// members. The current term is resolved server-side; a stale/selected non-current
// term is rejected so a past term's roster can't re-invite offboarded alumni.
//
// Body: { termId: string } — must equal the current term.

type Body = { termId: string };

function isBody(x: unknown): x is Body {
  return !!x && typeof x === "object" && typeof (x as Record<string, unknown>).termId === "string";
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
    return forbidden(request);
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

  if (!process.env.GITHUB_ORG) {
    return withCors(request, Response.json({ error: "GITHUB_ORG not set." }, { status: 400 }));
  }

  // Resolve the current term server-side and reject any other term. Prevents
  // syncing a past term (re-inviting offboarded members) or a future one.
  const term = await currentTerm();
  if (!term) {
    return withCors(request, Response.json({ error: "No current term." }, { status: 400 }));
  }
  if (body.termId !== term.id) {
    return withCors(
      request,
      Response.json(
        {
          error: `Sync only runs for the current term (${term.code}). Switch the board to the current term and try again.`,
        },
        { status: 409 },
      ),
    );
  }

  try {
    // Current-term projects with a live roster, excluding archived.
    const projects = await prisma.project.findMany({
      where: { assignments: { some: { termId: term.id } }, status: { not: "Archived" } },
      select: { id: true, name: true, githubTeamSlug: true },
      orderBy: { name: "asc" },
    });

    // githubTeamSlug is NOT @unique — detect duplicates across the sweep so two
    // projects that resolve to the same team aren't merged into one. Normalized
    // to lowercase because GitHub resolves team slugs case-insensitively
    // ("MyApp" and "myapp" are the same team).
    const slugCounts = new Map<string, number>();
    for (const p of projects) {
      const s = p.githubTeamSlug?.trim().toLowerCase();
      if (s) slugCounts.set(s, (slugCounts.get(s) ?? 0) + 1);
    }

    const reports: ProjectTeamSyncReport[] = [];
    for (const p of projects) {
      const s = p.githubTeamSlug?.trim().toLowerCase();
      if (s && (slugCounts.get(s) ?? 0) > 1) {
        reports.push({
          projectId: p.id,
          projectName: p.name,
          status: "skipped",
          slug: s,
          teamCreated: false,
          membersEnsured: 0,
          membersPending: 0,
          missingHandles: [],
          memberErrors: [],
          repos: [],
          message: `Slug "${s}" collides with another project — skipped to avoid merging teams. Set a unique slug.`,
        });
        continue;
      }
      // syncProjectTeam never throws, but guard belt-and-suspenders.
      const r = await syncProjectTeam(p.id, term.id).catch(
        (err): ProjectTeamSyncReport => ({
          projectId: p.id,
          projectName: p.name,
          status: "error",
          slug: s ?? null,
          teamCreated: false,
          membersEnsured: 0,
          membersPending: 0,
          missingHandles: [],
          memberErrors: [],
          repos: [],
          message: slackErrorMessage(err),
        }),
      );
      reports.push(r);
    }

    const okCount = reports.filter((r) => r.status === "ok").length;
    const skippedCount = reports.filter((r) => r.status === "skipped").length;
    const erroredCount = reports.filter((r) => r.status === "error").length;
    const membersEnsured = reports.reduce((n, r) => n + r.membersEnsured, 0);
    const membersPending = reports.reduce((n, r) => n + r.membersPending, 0);
    const missing = reports.reduce((n, r) => n + r.missingHandles.length, 0);

    // Per-project warnings the banner renders inline.
    const warnings = reports.flatMap((r) => {
      const w: string[] = [];
      if (r.status === "skipped") w.push(`${r.projectName}: ${r.message}`);
      if (r.missingHandles.length) {
        w.push(`${r.projectName}: no GitHub username for ${r.missingHandles.join(", ")}`);
      }
      for (const me of r.memberErrors) w.push(`${r.projectName}: @${me.handle} — ${me.message}`);
      for (const re of r.repos) {
        if (re.status === "error") w.push(`${r.projectName}: repo ${re.repo} — ${re.message}`);
      }
      return w;
    });

    await logAuditEvent({
      action: "staffing.sync_teams",
      userId: auth.user.sub,
      metadata: {
        termId: term.id,
        projectCount: projects.length,
        okCount,
        skippedCount,
        erroredCount,
        membersEnsured,
        membersPending,
        missing,
        // Bounded per-project counts only — no member names/arrays (keeps the
        // audit JSON small and free of PII; full detail is in the response body).
        projects: reports.map((r) => ({
          projectId: r.projectId,
          slug: r.slug,
          status: r.status,
          membersEnsured: r.membersEnsured,
          missingCount: r.missingHandles.length,
          memberErrorCount: r.memberErrors.length,
          repoErrorCount: r.repos.filter((x) => x.status === "error").length,
        })),
      },
    });

    const parts = [
      `synced ${okCount}/${projects.length} team${projects.length === 1 ? "" : "s"} for ${term.code}`,
      `ensured ${membersEnsured} member${membersEnsured === 1 ? "" : "s"}${
        membersPending ? ` (${membersPending} pending)` : ""
      }`,
    ];
    if (missing) parts.push(`${missing} without a GitHub username`);
    if (skippedCount) parts.push(`${skippedCount} skipped`);
    if (erroredCount) parts.push(`${erroredCount} with errors`);

    return withCors(
      request,
      Response.json({
        ok: erroredCount === 0, // partial failure => false => banner renders red
        message: `${parts.join("; ")}.`,
        warnings,
        reports,
      }),
    );
  } catch (err) {
    return withCors(request, Response.json({ error: slackErrorMessage(err) }, { status: 500 }));
  }
}
