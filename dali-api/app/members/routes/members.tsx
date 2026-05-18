import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/members";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { initialsFromName } from "~/lib/display";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";

export const meta: Route.MetaFunction = () => [{ title: "Members · DALI OS" }];

type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  pronouns: string | null;
  classYear: number | null;
  photoUrl: string | null;
  isAdmin: boolean;
  coreTitles: string[];
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");

  // Lab members are Users with a DALIMember row attached. Roles derive from
  // AdminMembership + CoreAssignment per the Phase 2 identity model — see
  // app/admin-console/routes/api.members.ts for the canonical shape.
  const users = await prisma.user.findMany({
    where: { daliMember: { isNot: null } },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      dartmouthEmail: true,
      pronouns: true,
      classYear: true,
      photoUrl: true,
      adminMembership: { select: { id: true } },
      coreAssignments: { select: { leadTitle: true } },
    },
  });

  const rows: MemberRow[] = users.map((u) => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.daliEmail ?? u.dartmouthEmail,
    pronouns: u.pronouns,
    classYear: u.classYear,
    photoUrl: u.photoUrl,
    isAdmin: u.adminMembership !== null,
    // Dedupe lead titles across terms — a "Hiring Lead" who held the title
    // for three terms should still show one chip.
    coreTitles: Array.from(
      new Set(u.coreAssignments.map((a) => a.leadTitle).filter((t): t is string => !!t)),
    ),
  }));

  return { rows };
}

export default function MembersList() {
  const { rows } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:members", "list");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = `${r.firstName} ${r.lastName}`.toLowerCase();
      const email = (r.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Members</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everyone with a DALI membership row.
        </p>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <ViewToggle value={view} onChange={setView} />
      </div>

      <div className="bg-card border border-border rounded-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-foreground">All members</h2>
          <span className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "member" : "members"}
            {query && filtered.length !== rows.length ? ` of ${rows.length}` : ""}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {query ? "No members match this search." : "No members yet."}
          </div>
        ) : view === "list" ? (
          <MembersTable rows={filtered} />
        ) : (
          <MembersCards rows={filtered} />
        )}
      </div>
    </div>
  );
}

function MembersTable({ rows }: { rows: MemberRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Email</th>
            <th className="text-left font-medium px-4 py-2">Roles</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              onClick={() => navigate(`/members/${m.id}`)}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2 text-foreground">
                {m.firstName} {m.lastName}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{m.email ?? "—"}</td>
              <td className="px-4 py-2">
                <RolePills isAdmin={m.isAdmin} coreTitles={m.coreTitles} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersCards({ rows }: { rows: MemberRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3">
      {rows.map((m) => (
        <MemberCard key={m.id} member={m} />
      ))}
    </div>
  );
}

function MemberCard({ member }: { member: MemberRow }) {
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  return (
    <Link
      to={`/members/${member.id}`}
      className="border border-border rounded-md p-3 bg-background flex items-start gap-3 hover:bg-muted/10 transition-colors"
    >
      <Avatar photoUrl={member.photoUrl} name={fullName} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-foreground truncate">{fullName}</span>
          {member.pronouns && (
            <span className="text-xs text-muted-foreground">{member.pronouns}</span>
          )}
        </div>
        {member.classYear && (
          <div className="text-xs text-muted-foreground">Class of {member.classYear}</div>
        )}
        {member.email && (
          <div className="text-xs text-muted-foreground truncate mt-0.5">{member.email}</div>
        )}
        <div className="mt-2">
          <RolePills isAdmin={member.isAdmin} coreTitles={member.coreTitles} />
        </div>
      </div>
    </Link>
  );
}

function Avatar({ photoUrl, name }: { photoUrl: string | null; name: string }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-accent-coral/15 text-accent-coral flex items-center justify-center font-bold text-sm flex-shrink-0">
      {initialsFromName(name)}
    </div>
  );
}

function RolePills({ isAdmin, coreTitles }: { isAdmin: boolean; coreTitles: string[] }) {
  if (!isAdmin && coreTitles.length === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {isAdmin && (
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-accent-coral/15 text-accent-coral">
          Admin
        </span>
      )}
      {coreTitles.map((title) => (
        <span
          key={title}
          className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-muted text-foreground"
        >
          {title}
        </span>
      ))}
    </div>
  );
}
