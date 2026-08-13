import { defineCsvExport, type CsvExportContext } from "~/lib/csv-export.server";
import { prisma } from "~/lib/db";
import { isCore, isAdminViaEnv, currentTerm } from "~/lib/roles";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
} from "~/lib/audit-query";
import { JOBS } from "~/jobs/registry";

// All six Admin tables gate identically: Core or Admin (isCore covers both —
// see ~/lib/roles). Same check every admin page loader in app/admin/routes/
// uses before rendering, replicated here so the export can't show more than
// the page would.
async function isCoreCtx(ctx: CsvExportContext): Promise<boolean> {
  return isCore(ctx.user.sub);
}

const dateStamp = () => new Date().toISOString().slice(0, 10);

// ─── Members (Roles & Permissions) — mirrors admin.members.tsx loader ───────

defineCsvExport({
  id: "admin-members",
  filename: () => `admin-members-${dateStamp()}.csv`,
  authorize: isCoreCtx,
  async rows() {
    const [users, term] = await Promise.all([
      prisma.user.findMany({
        where: { ...LAB_MEMBER_WHERE },
        include: {
          adminMembership: { select: { id: true, isStaff: true } },
          coreAssignments: { select: { id: true, termId: true, leadTitle: true } },
          domainLeadAssignmentsAsUser: { include: { domain: true } },
        },
        orderBy: MEMBER_LIST_ORDER_BY,
      }),
      currentTerm(),
    ]);

    const out: unknown[][] = [
      ["Name", "DALI Email", "Admin", "Staff", "Core", "Core Titles", "Domain Leads"],
    ];
    for (const u of users) {
      const currentCore = term !== null ? u.coreAssignments.filter((a) => a.termId === term.id) : [];
      const isAdminUser = u.adminMembership !== null || isAdminViaEnv(u.id);
      out.push([
        `${u.firstName} ${u.lastName}`.trim(),
        u.daliEmail ?? "",
        isAdminUser ? "yes" : "",
        u.adminMembership?.isStaff === true ? "yes" : "",
        isAdminUser || currentCore.length > 0 ? "yes" : "",
        currentCore.map((a) => a.leadTitle || "Core").join("; "),
        u.domainLeadAssignmentsAsUser.map((a) => a.domain.displayName).join("; "),
      ]);
    }
    return out;
  },
});

// ─── Domains — mirrors admin.domains.tsx loader ──────────────────────────────

defineCsvExport({
  id: "admin-domains",
  filename: () => `admin-domains-${dateStamp()}.csv`,
  authorize: isCoreCtx,
  async rows() {
    const domains = await prisma.domain.findMany({
      orderBy: { displayName: "asc" },
      include: {
        domainLeadAssignments: {
          include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
        },
        eligibilities: {
          include: { user: { select: { firstName: true, lastName: true, daliEmail: true } } },
        },
      },
    });

    const out: unknown[][] = [["Domain", "Person", "DALI Email", "Role"]];
    for (const d of domains) {
      for (const a of d.domainLeadAssignments) {
        out.push([d.displayName, `${a.user.firstName} ${a.user.lastName}`.trim(), a.user.daliEmail ?? "", "Lead"]);
      }
      for (const e of d.eligibilities) {
        out.push([
          d.displayName,
          `${e.user.firstName} ${e.user.lastName}`.trim(),
          e.user.daliEmail ?? "",
          `Eligible (${e.level})`,
        ]);
      }
    }
    return out;
  },
});

// ─── Activity log — mirrors admin.activity.tsx loader, same filters, no ────
// pagination cap (an admin who applied filters gets the full filtered set).

defineCsvExport({
  id: "admin-activity",
  filename: () => `admin-activity-${dateStamp()}.csv`,
  authorize: isCoreCtx,
  async rows(ctx) {
    const filters = parseAuditFilters(ctx.searchParams);
    const baseWhere = buildAuditWhere(filters);
    const textPatch = await resolveAuditTextFilters(prisma, filters);
    const where = { ...baseWhere, ...textPatch };

    const entries = await prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const ids = new Set<string>();
    for (const e of entries) {
      if (e.userId) ids.add(e.userId);
      if (e.targetId) ids.add(e.targetId);
    }
    const users =
      ids.size === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: Array.from(ids) } },
            select: { id: true, firstName: true, lastName: true, daliEmail: true },
          });
    const userById = new Map(users.map((u) => [u.id, u]));
    const label = (id: string | null) => {
      if (!id) return "";
      const u = userById.get(id);
      return u ? fullName(u) || u.daliEmail || id : id;
    };

    const out: unknown[][] = [["When", "Actor", "Action", "Target", "Metadata", "IP"]];
    for (const e of entries) {
      out.push([
        e.createdAt.toISOString(),
        e.userId ? label(e.userId) : "system",
        e.action,
        label(e.targetId),
        e.metadata ? JSON.stringify(e.metadata) : "",
        e.ip ?? "",
      ]);
    }
    return out;
  },
});

// ─── AI Usage — mirrors admin.ai-usage.tsx loader ────────────────────────────

const AI_USAGE_RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

defineCsvExport({
  id: "admin-ai-usage",
  filename: (ctx) => `admin-ai-usage-${ctx.searchParams.get("range") ?? "30d"}-${dateStamp()}.csv`,
  authorize: isCoreCtx,
  async rows(ctx) {
    const days = AI_USAGE_RANGE_DAYS[ctx.searchParams.get("range") ?? "30d"] ?? 30;
    const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const perUser = await prisma.aiUsage.groupBy({
      by: ["userId"],
      where: { day: { gte: since } },
      _sum: { count: true, inputTokens: true, outputTokens: true },
      _max: { day: true },
      orderBy: { _sum: { count: "desc" } },
    });
    const users =
      perUser.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: perUser.map((r) => r.userId) } },
            select: { id: true, firstName: true, lastName: true, daliEmail: true },
          });
    const userById = new Map(users.map((u) => [u.id, u]));

    const out: unknown[][] = [["Member", "Email", "Requests", "Input Tokens", "Output Tokens", "Last Used"]];
    for (const r of perUser) {
      const u = userById.get(r.userId);
      out.push([
        (u && (fullName(u) || u.daliEmail)) ?? r.userId,
        u?.daliEmail ?? "",
        r._sum.count ?? 0,
        r._sum.inputTokens ?? 0,
        r._sum.outputTokens ?? 0,
        r._max.day ?? "",
      ]);
    }
    return out;
  },
});

// ─── Jobs — mirrors admin.jobs.tsx loader ───────────────────────────────────

defineCsvExport({
  id: "admin-jobs",
  filename: () => `admin-jobs-${dateStamp()}.csv`,
  authorize: isCoreCtx,
  async rows() {
    const rows = await prisma.scheduledJob.findMany();
    const rowByName = new Map(rows.map((r) => [r.name, r]));

    const out: unknown[][] = [
      ["Job", "Enabled", "Interval (min)", "Next Run", "Last Run", "Last Status", "Last Error"],
    ];
    for (const def of JOBS) {
      const row = rowByName.get(def.name);
      out.push([
        def.name,
        (row?.enabled ?? true) ? "yes" : "no",
        row?.intervalMinutes ?? def.intervalMinutes,
        row?.nextRunAt?.toISOString() ?? "",
        row?.lastRunAt?.toISOString() ?? "",
        row?.lastStatus ?? "",
        row?.lastError ?? "",
      ]);
    }
    return out;
  },
});

// ─── Analytics — mirrors admin.analytics.tsx loader. One export id, ─────────
// `?view=` picks the sub-table (top-routes/bottom-routes/errors), same
// bundling convention as admin/routes/admin.payroll.csv.ts.

const ANALYTICS_RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

defineCsvExport({
  id: "admin-analytics",
  filename: (ctx) => {
    const view = ctx.searchParams.get("view") ?? "top-routes";
    return `admin-analytics-${view}-${dateStamp()}.csv`;
  },
  authorize: isCoreCtx,
  async rows(ctx) {
    const view = ctx.searchParams.get("view") ?? "top-routes";
    const days = ANALYTICS_RANGE_DAYS[ctx.searchParams.get("range") ?? "30d"] ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    if (view === "errors") {
      const errorRows = await prisma.$queryRaw<
        { message: string; count: number; users: number; firstSeen: Date; lastSeen: Date }[]
      >`
        SELECT "message",
               COUNT(*)::int AS count,
               COUNT(DISTINCT "userId")::int AS users,
               MIN("createdAt") AS "firstSeen",
               MAX("createdAt") AS "lastSeen"
        FROM "ClientError"
        WHERE "createdAt" >= ${since}
        GROUP BY "message"
        ORDER BY "lastSeen" DESC
        LIMIT 50
      `;
      const out: unknown[][] = [["Message", "Count", "Users", "First Seen", "Last Seen"]];
      for (const e of errorRows) {
        out.push([e.message, e.count, e.users, e.firstSeen.toISOString(), e.lastSeen.toISOString()]);
      }
      return out;
    }

    const routeRows =
      view === "bottom-routes"
        ? await prisma.$queryRaw<{ path: string; views: number; users: number }[]>`
            SELECT "path", COUNT(*)::int AS views, COUNT(DISTINCT "userId")::int AS users
            FROM "PageView"
            WHERE "createdAt" >= ${since}
            GROUP BY "path"
            HAVING COUNT(*) < 5
            ORDER BY views ASC, "path" ASC
            LIMIT 10
          `
        : await prisma.$queryRaw<{ path: string; views: number; users: number }[]>`
            SELECT "path", COUNT(*)::int AS views, COUNT(DISTINCT "userId")::int AS users
            FROM "PageView"
            WHERE "createdAt" >= ${since}
            GROUP BY "path"
            ORDER BY views DESC
            LIMIT 10
          `;
    const out: unknown[][] = [["Path", "Views", "Users"]];
    for (const r of routeRows) out.push([r.path, r.views, r.users]);
    return out;
  },
});
