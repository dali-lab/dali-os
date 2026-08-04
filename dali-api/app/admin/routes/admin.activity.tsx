import { Form, Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin.activity";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { fullName } from "~/lib/display";
import { AUDIT_ACTIONS } from "~/lib/audit-actions";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
  activeFilterParams,
  hasAnyFilter,
} from "~/lib/audit-query";
import { ListTodo, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import { DateField } from "~/components/ui/DateField";

export const handle = adminHandle("activity");

export const meta: Route.MetaFunction = () => [{ title: "Activity · Admin · DALI OS" }];

// Read-only viewer over the AuditLog table. Offset-paginated and filterable
// on the indexed columns (action, userId, createdAt) plus a cheap equality
// check on targetId. The Next link uses prefetch="render" so the next page's
// loader runs the moment the current page renders, making the click feel
// instant.

const PAGE_SIZE = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const filters = parseAuditFilters(url.searchParams);
  const baseWhere = buildAuditWhere(filters);
  const textPatch = await resolveAuditTextFilters(prisma, filters);
  const where = { ...baseWhere, ...textPatch };

  // Take one extra to detect whether a next page exists without a separate
  // count() query (count() over a large AuditLog is expensive).
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    skip,
  });

  const hasNext = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  // Resolve actor + target display names in a single round-trip rather than
  // per-row. Targets are typed loosely (string id with no FK back to a
  // single table), so we only attempt User resolution and fall back to the
  // raw id when it doesn't match.
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

  const admin = await isAdmin(auth.user.sub);
  return {
    page,
    hasNext,
    filters,
    anyFilter: hasAnyFilter(filters),
    actions: AUDIT_ACTIONS,
    isAdmin: admin,
    entries: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      action: e.action,
      actor: e.userId ? (userById.get(e.userId) ?? null) : null,
      actorId: e.userId,
      target: e.targetId ? (userById.get(e.targetId) ?? null) : null,
      targetId: e.targetId,
      metadata: e.metadata,
      ip: e.ip,
    })),
  };
}

type PersonRow = { firstName: string; lastName: string; daliEmail: string | null };

function displayPerson(u: PersonRow | null, fallbackId: string | null) {
  if (u) {
    const name = fullName(u);
    return <span>{name || u.daliEmail || "—"}</span>;
  }
  // Has an id but couldn't resolve it (User row missing, or targetId points
  // at a non-User resource like a domain/group/document).
  if (fallbackId) {
    return (
      <span className="font-mono text-xs text-muted-foreground/70">{fallbackId.slice(0, 8)}…</span>
    );
  }
  return null;
}

// Actor column: a missing userId means an unauthenticated request (token
// validation failure, etc.), and "system" is the meaningful label.
function displayActor(u: PersonRow | null, fallbackId: string | null) {
  return (
    displayPerson(u, fallbackId) ?? (
      <span className="text-muted-foreground/60 italic">system</span>
    )
  );
}

// Target column: a missing targetId means the action simply has no target
// (login.success, email.send, confidentiality.sign, …). Don't fabricate a
// "system" label — render an em-dash like the empty-metadata cell.
function displayTarget(u: PersonRow | null, fallbackId: string | null) {
  return (
    displayPerson(u, fallbackId) ?? <span className="text-muted-foreground/50">—</span>
  );
}

const inputClass =
  "bg-page border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

export default function AdminConsoleActivity() {
  const { page, hasNext, filters, anyFilter, actions, entries } = useLoaderData<typeof loader>();

  // Pagination links: carry active filters but never the previous page slot.
  function pageHref(nextPage: number): string {
    const params = activeFilterParams(filters);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ListTodo className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Activity log</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          page {page}
        </span>
      </div>

      <Form
        method="get"
        className="bg-card border border-border rounded-lg p-3 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end"
      >
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Action
          <select
            name="action"
            defaultValue={filters.action ?? ""}
            className={`${inputClass} font-mono`}
          >
            <option value="">All</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Person
          <input
            type="text"
            name="person"
            defaultValue={filters.person ?? ""}
            placeholder="name, email, or id"
            title="Matches as actor or target — what did this person do, and what was done to them"
            className={inputClass}
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          From
          <DateField
            mode="date"
            name="from"
            defaultValue={filters.from ?? ""}
            ariaLabel="From date"
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          To
          <DateField
            mode="date"
            name="to"
            defaultValue={filters.to ?? ""}
            ariaLabel="To date"
          />
        </label>
        <div className="sm:col-span-4 flex items-center gap-2">
          <button
            type="submit"
            className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90"
          >
            Apply
          </button>
          {anyFilter && (
            <Tooltip label="Clear filters">
              <Link
                to="?"
                aria-label="Clear filters"
                className="inline-flex items-center justify-center p-1.5 rounded-md text-sm bg-card border border-border text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </Link>
            </Tooltip>
          )}
        </div>
      </Form>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">When</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Metadata</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground/70">
                  {anyFilter
                    ? "No activity matches these filters."
                    : "No activity on this page."}
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">{displayActor(e.actor, e.actorId)}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">{e.action}</td>
                <td className="px-4 py-3">{displayTarget(e.target, e.targetId)}</td>
                <td className="px-4 py-3">
                  {e.metadata ? (
                    <code
                      className="block text-[11px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 max-w-md truncate"
                      title={JSON.stringify(e.metadata)}
                    >
                      {JSON.stringify(e.metadata)}
                    </code>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="flex items-center justify-between" aria-label="Activity pagination">
        {page > 1 ? (
          <Tooltip label="Previous">
            <Link
              to={pageHref(page - 1)}
              prefetch="render"
              aria-label="Previous"
              className="inline-flex items-center justify-center p-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
            >
              <ChevronLeft className="w-4 h-4" />
            </Link>
          </Tooltip>
        ) : (
          <span />
        )}
        {hasNext ? (
          <Tooltip label="Next">
            <Link
              to={pageHref(page + 1)}
              prefetch="render"
              aria-label="Next"
              className="inline-flex items-center justify-center p-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
            >
              <ChevronRight className="w-4 h-4" />
            </Link>
          </Tooltip>
        ) : (
          <span className="text-xs text-muted-foreground/60">End of log</span>
        )}
      </nav>
    </div>
  );
}
