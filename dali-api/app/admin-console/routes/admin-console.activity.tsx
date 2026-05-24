import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.activity";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { ListTodo, ChevronLeft, ChevronRight } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Activity · Operations · DALI OS" }];

// Read-only viewer over the AuditLog table — the same data that
// /api/audit-logs returns programmatically. Offset-paginated; the Next link
// uses prefetch="render" so the next page's loader runs the moment the
// current page renders, making the click feel instant.

const PAGE_SIZE = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/admin-console");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Take one extra to detect whether a next page exists without a separate
  // count() query (count() over a large AuditLog table is expensive).
  const rows = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    skip,
  });

  const hasNext = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  // Resolve actor + target display names in a single round-trip rather than
  // per-row. Targets in this table are typed loosely (string id with no FK
  // back to a single table), so we only attempt User resolution and fall
  // back to the raw id when it doesn't match.
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.userId) ids.add(e.userId);
    if (e.targetId) ids.add(e.targetId);
  }
  const users = ids.size === 0
    ? []
    : await prisma.user.findMany({
        where: { id: { in: Array.from(ids) } },
        select: { id: true, firstName: true, lastName: true, daliEmail: true },
      });
  const userById = new Map(users.map((u) => [u.id, u]));

  return {
    page,
    hasNext,
    entries: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      action: e.action,
      actor: e.userId ? userById.get(e.userId) ?? null : null,
      actorId: e.userId,
      target: e.targetId ? userById.get(e.targetId) ?? null : null,
      targetId: e.targetId,
      metadata: e.metadata,
      ip: e.ip,
    })),
  };
}

function displayActor(u: { firstName: string; lastName: string; daliEmail: string | null } | null, fallbackId: string | null) {
  if (!u) return fallbackId ? <span className="font-mono text-xs text-muted-foreground/70">{fallbackId.slice(0, 8)}…</span> : <span className="text-muted-foreground/60 italic">system</span>;
  const name = `${u.firstName} ${u.lastName}`.trim();
  return <span>{name || u.daliEmail || "—"}</span>;
}

export default function AdminConsoleActivity() {
  const { page, hasNext, entries } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ListTodo className="w-6 h-6 text-foreground/80" />
        <h1 className="text-2xl font-bold text-foreground">Activity log</h1>
        <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          page {page}
        </span>
      </div>

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
                  No activity on this page.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  {displayActor(e.actor, e.actorId)}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-foreground">{e.action}</td>
                <td className="px-4 py-3">
                  {displayActor(e.target, e.targetId)}
                </td>
                <td className="px-4 py-3">
                  {e.metadata ? (
                    <code className="block text-[11px] text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5 max-w-md truncate" title={JSON.stringify(e.metadata)}>
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
          <Link
            to={`?page=${page - 1}`}
            prefetch="render"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </Link>
        ) : <span />}
        {hasNext ? (
          <Link
            to={`?page=${page + 1}`}
            prefetch="render"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm bg-card border border-border text-foreground hover:bg-muted/50"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Link>
        ) : <span className="text-xs text-muted-foreground/60">End of log</span>}
      </nav>
    </div>
  );
}
