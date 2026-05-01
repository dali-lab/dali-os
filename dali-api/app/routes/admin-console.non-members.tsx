import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.non-members";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { UserCircle, ExternalLink } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Non-Members · Admin console · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  const admin = await isAdmin(auth.user.sub);
  if (!admin) return withAuth(auth, redirect("/"));

  const users = await prisma.user.findMany({
    where: { daliMember: null },
    select: {
      id: true,
      createdAt: true,
      firstName: true,
      lastName: true,
      dartmouthEmail: true,
      daliEmail: true,
      netId: true,
      applications: {
        select: {
          id: true,
          applicationCycle: { select: { name: true } },
          statusUpdates: {
            select: { newStatus: true },
            orderBy: { createdAt: "desc" as const },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" as const },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return withAuth(auth, { accounts: users });
}

export default function AdminConsoleNonMembers() {
  const { accounts } = useLoaderData<typeof loader>();
  const [search, setSearch] = useState("");

  const filtered = accounts.filter((u) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const name = `${u.firstName} ${u.lastName}`.toLowerCase();
    const email = (u.dartmouthEmail ?? u.daliEmail ?? "").toLowerCase();
    const netId = (u.netId ?? "").toLowerCase();
    return name.includes(q) || email.includes(q) || netId.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <UserCircle className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">Non-Members</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {filtered.length}{filtered.length !== accounts.length ? ` of ${accounts.length}` : ""} accounts
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="account-search" className="sr-only">Search accounts by name, email, or NetID</label>
          <input
            id="account-search"
            type="text"
            placeholder="Search by name, email, or NetID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Platform accounts not linked to a DALI member — typically applicants who signed in during hiring.
      </p>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">NetID</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Application</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground/70">
                  No accounts found.
                </td>
              </tr>
            )}
            {filtered.map((user) => (
              <tr key={user.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 font-medium text-foreground">
                  {user.firstName} {user.lastName}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.dartmouthEmail ?? user.daliEmail ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {user.netId ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {user.applications.length > 0 ? (
                    <Link
                      to={`/hiring/reviewer/application/${user.applications[0].id}`}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {user.applications.length === 1
                        ? user.applications[0].applicationCycle.name
                        : `${user.applications.length} applications`}
                    </Link>
                  ) : (
                    <span className="text-xs text-muted-foreground/70">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {user.applications.length > 0 ? (() => {
                    const status = user.applications[0].statusUpdates[0]?.newStatus ?? "Draft";
                    const colors =
                      status === "Submitted" ? "bg-blue-100 text-blue-800"
                      : status === "Withdrawn" ? "bg-red-100 text-red-800"
                      : "bg-gray-100 text-gray-800";
                    return (
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
                        {status}
                      </span>
                    );
                  })() : (
                    <span className="text-xs text-muted-foreground/70">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
