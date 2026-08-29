import type { Route } from "./+types/api.staffing.sync-vault";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { canManageStaffing, currentTerm } from "~/lib/roles";
import { withCors, handlePreflight } from "~/lib/cors";
import { slackErrorMessage } from "~/slack/lib/slack-client";
import { logAuditEvent } from "~/lib/audit";
import { vaultwardenConfigured } from "~/lib/vaultwarden";
import {
  externalFinalizeAllowed,
  EXTERNAL_FINALIZE_SKIP_MESSAGE,
} from "~/projects/lib/finalize-external.server";
import {
  syncProjectVault,
  type ProjectVaultSyncReport,
} from "~/projects/lib/vaultwarden-group-sync";

// POST /api/staffing/sync-vault
//
// Add-only Vaultwarden group sync for EVERY project staffed this term: ensure
// each project's org group, invite/add its rostered members (by daliEmail), and
// grant the group access to the project's collection (when a collection id is
// set). Idempotent — safe to re-run. Never removes members. Mirrors
// /api/staffing/sync-teams (GitHub). The current term is resolved server-side; a
// stale/selected non-current term is rejected so a past term's roster can't
// re-invite offboarded alumni.
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

  // Prod-only (or FINALIZE_EXTERNAL_OVERRIDE=1): non-prod tokens point at the
  // same real Vaultwarden org, so a sweep would mutate real groups. Mirrors the
  // finalize automation gate.
  if (!externalFinalizeAllowed()) {
    return withCors(request, Response.json({ error: EXTERNAL_FINALIZE_SKIP_MESSAGE }, { status: 400 }));
  }
  if (!vaultwardenConfigured()) {
    return withCors(request, Response.json({ error: "Vaultwarden is not configured." }, { status: 400 }));
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    const reports: ProjectVaultSyncReport[] = [];
    for (const p of projects) {
      // syncProjectVault isolates its own failures, but guard belt-and-suspenders.
      const r = await syncProjectVault(p.id, term.id).catch(
        (err): ProjectVaultSyncReport => ({
          projectId: p.id,
          projectName: p.name,
          status: "error",
          groupId: null,
          groupCreated: false,
          membersEnsured: 0,
          invited: 0,
          membersUnconfirmed: [],
          missingEmails: [],
          collectionGranted: false,
          memberErrors: [{ email: "(sync)", message: slackErrorMessage(err) }],
          message: slackErrorMessage(err),
        }),
      );
      reports.push(r);
    }

    const okCount = reports.filter((r) => r.status === "ok").length;
    const skippedCount = reports.filter((r) => r.status === "skipped").length;
    const erroredCount = reports.filter((r) => r.status === "error").length;
    const membersEnsured = reports.reduce((n, r) => n + r.membersEnsured, 0);
    const invited = reports.reduce((n, r) => n + r.invited, 0);
    const unconfirmed = reports.reduce((n, r) => n + r.membersUnconfirmed.length, 0);
    const missing = reports.reduce((n, r) => n + r.missingEmails.length, 0);

    // Per-project warnings the banner renders inline.
    const warnings = reports.flatMap((r) => {
      const w: string[] = [];
      if (r.status === "skipped") w.push(`${r.projectName}: ${r.message}`);
      if (r.membersUnconfirmed.length) {
        w.push(`${r.projectName}: awaiting web-vault confirmation for ${r.membersUnconfirmed.join(", ")}`);
      }
      if (r.missingEmails.length) {
        w.push(`${r.projectName}: no DALI email for ${r.missingEmails.join(", ")}`);
      }
      for (const me of r.memberErrors) w.push(`${r.projectName}: ${me.email} — ${me.message}`);
      return w;
    });

    await logAuditEvent({
      action: "staffing.sync_vault",
      userId: auth.user.sub,
      metadata: {
        termId: term.id,
        projectCount: projects.length,
        okCount,
        skippedCount,
        erroredCount,
        membersEnsured,
        invited,
        unconfirmed,
        missing,
        // Bounded per-project counts only — no member names/arrays (keeps the
        // audit JSON small and free of PII; full detail is in the response body).
        projects: reports.map((r) => ({
          projectId: r.projectId,
          groupId: r.groupId,
          status: r.status,
          membersEnsured: r.membersEnsured,
          invited: r.invited,
          unconfirmedCount: r.membersUnconfirmed.length,
          missingCount: r.missingEmails.length,
          memberErrorCount: r.memberErrors.length,
        })),
      },
    });

    const parts = [
      `synced ${okCount}/${projects.length} group${projects.length === 1 ? "" : "s"} for ${term.code}`,
      `ensured ${membersEnsured} member${membersEnsured === 1 ? "" : "s"}${invited ? ` (${invited} invited)` : ""}`,
    ];
    if (unconfirmed) parts.push(`${unconfirmed} awaiting confirmation`);
    if (missing) parts.push(`${missing} without a DALI email`);
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
