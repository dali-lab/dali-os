import { useState } from "react";
import { Form, Link, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/admin-console.audit";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import {
  buildAuditWhere,
  encodeCursor,
  parseCursor,
  parseFilters,
  parseLimit,
} from "~/lib/audit-query";

export const meta: Route.MetaFunction = () => [
  { title: "Audit logs · Admin console · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (!(await isAdmin(auth.user.sub))) return withAuth(auth, redirect("/"));

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const cursor = parseCursor(url.searchParams.get("before"));
  const filters = parseFilters(url.searchParams);

  const [rows, actionGroups] = await Promise.all([
    prisma.auditLog.findMany({
      where: buildAuditWhere(filters, cursor),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.auditLog.groupBy({ by: ["action"], orderBy: { action: "asc" } }),
  ]);

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;
  const last = entries[entries.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;

  // userId on AuditLog is User.id (set from auth.user.sub at write time). Look
  // up display names for the userIds present in this page so the UI shows
  // "Jane Doe" instead of a bare cuid. Falls back to the raw id when missing
  // (deleted users, unattributed events).
  const userIds = Array.from(new Set(entries.map((e) => e.userId).filter((x): x is string => !!x)));
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const userById: Record<string, { firstName: string; lastName: string }> = {};
  for (const u of users) userById[u.id] = { firstName: u.firstName, lastName: u.lastName };

  return withAuth(auth, {
    entries,
    actions: actionGroups.map((g) => g.action),
    nextCursor,
    userById,
    filters: {
      action: filters.action ?? "",
      userId: filters.userId ?? "",
      targetId: filters.targetId ?? "",
      from: url.searchParams.get("from") ?? "",
      to: url.searchParams.get("to") ?? "",
    },
  });
}

const ACTION_PILL: Record<string, string> = {
  "login.success": "bg-emerald-100 text-emerald-800",
  "login.failure": "bg-rose-100 text-rose-800",
  logout: "bg-muted text-foreground",
  "auth.token.invalid": "bg-rose-100 text-rose-800",
  "role.change": "bg-amber-100 text-amber-800",
  "decision.finalize": "bg-blue-100 text-blue-800",
  "decision.release": "bg-violet-100 text-violet-800",
  "email.send": "bg-sky-100 text-sky-800",
  "confidentiality.sign": "bg-teal-100 text-teal-800",
};

function pillClass(action: string) {
  return ACTION_PILL[action] ?? "bg-muted text-foreground";
}

function formatTime(d: string | Date) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString();
}

export default function AdminConsoleAudit() {
  const { entries, actions, nextCursor, userById, filters } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const nextHref = (() => {
    if (!nextCursor) return null;
    const next = new URLSearchParams(searchParams);
    next.set("before", nextCursor);
    return `?${next.toString()}`;
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit logs</h1>
          <p className="text-sm text-muted-foreground">
            Security-relevant events. Newest first.
          </p>
        </div>
      </div>

      <Form
        method="get"
        className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 md:grid-cols-5 gap-3"
      >
        <label className="flex flex-col text-xs text-muted-foreground">
          Action
          <select
            name="action"
            defaultValue={filters.action}
            className="mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          >
            <option value="">All</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          User ID
          <input
            name="userId"
            defaultValue={filters.userId}
            placeholder="User.id"
            className="mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          Target ID
          <input
            name="targetId"
            defaultValue={filters.targetId}
            className="mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          From
          <input
            type="datetime-local"
            name="from"
            defaultValue={filters.from}
            className="mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <label className="flex flex-col text-xs text-muted-foreground">
          To
          <input
            type="datetime-local"
            name="to"
            defaultValue={filters.to}
            className="mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <div className="md:col-span-5 flex items-center gap-2">
          <button
            type="submit"
            className="px-4 py-2 text-sm rounded-md bg-foreground text-background hover:opacity-90"
          >
            Apply
          </button>
          <Link
            to="/admin-console/audit"
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted"
          >
            Clear
          </Link>
        </div>
      </Form>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-44">Time</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Action</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Target</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground w-32">IP</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No entries match these filters.
                </td>
              </tr>
            )}
            {entries.map((e) => {
              const u = e.userId ? userById[e.userId] : null;
              const actor = u ? `${u.firstName} ${u.lastName}` : e.userId ?? "—";
              const isOpen = expanded === e.id;
              return (
                <>
                  <tr
                    key={e.id}
                    className="hover:bg-muted/50 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                  >
                    <td className="px-4 py-3 text-foreground" title={String(e.createdAt)}>
                      {formatTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      <div>{actor}</div>
                      {u && (
                        <div className="text-xs text-muted-foreground font-mono">{e.userId}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pillClass(e.action)}`}
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground font-mono text-xs">
                      {e.targetId ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-foreground font-mono text-xs">{e.ip ?? "—"}</td>
                    <td className="px-2 py-3 text-muted-foreground text-center">
                      {isOpen ? "▾" : "▸"}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${e.id}-expanded`} className="bg-muted/30">
                      <td colSpan={6} className="px-4 py-3">
                        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-xs">
                          <dt className="text-muted-foreground">Audit ID</dt>
                          <dd className="font-mono">{e.id}</dd>
                          <dt className="text-muted-foreground">User-Agent</dt>
                          <dd className="font-mono break-all">{e.userAgent ?? "—"}</dd>
                          <dt className="text-muted-foreground">Metadata</dt>
                          <dd>
                            <pre className="bg-background border border-border rounded p-2 overflow-x-auto">
                              {e.metadata ? JSON.stringify(e.metadata, null, 2) : "null"}
                            </pre>
                          </dd>
                        </dl>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        {nextHref ? (
          <Link
            to={nextHref}
            className="px-4 py-2 text-sm rounded-md border border-border hover:bg-muted"
          >
            Load more
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">End of results</span>
        )}
      </div>
    </div>
  );
}
