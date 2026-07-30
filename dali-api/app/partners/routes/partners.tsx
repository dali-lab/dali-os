import { useMemo, useState } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigate,
} from "react-router";
import type { Route } from "./+types/partners";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { canViewStaffing, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { AreaPillNav } from "~/components/AreaPillNav";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { buttonClasses } from "~/components/ui/Button";
import { OPEN_APPLICATION_STATUSES } from "../lib/partner-application";
import { normalizeWebsite } from "../lib/partner-org";
import { createPartnerInvite } from "../lib/invites.server";
import { FileText, LayoutGrid } from "lucide-react";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Partners · DALI OS" }];

type OrgRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  website: string | null;
  isIndividual: boolean;
  memberCount: number;
  activeProjectCount: number;
  totalProjectCount: number;
  openApplicationCount: number;
  archived: boolean;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const now = new Date();
  const showArchived =
    new URL(request.url).searchParams.get("archived") === "1";
  const [orgs, canEdit] = await Promise.all([
    prisma.partnerOrg.findMany({
      // Former partners are archived, not deleted — hidden here unless asked.
      where: showArchived ? {} : { archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        website: true,
        isIndividual: true,
        archivedAt: true,
        _count: { select: { users: true } },
        projects: {
          select: {
            startedAt: true,
            endedAt: true,
            project: { select: { status: true } },
          },
        },
        applications: { select: { status: true } },
      },
    }),
    isCore(auth.user.sub),
  ]);

  const rows: OrgRow[] = await Promise.all(
    orgs.map(async (o) => ({
      id: o.id,
      name: o.name,
      // Uploaded logos are stored as S3 keys; presign for display.
      logoUrl: await resolvePhotoUrl(o.logoUrl),
      website: o.website,
      isIndividual: o.isIndividual,
      memberCount: o._count.users,
      activeProjectCount: o.projects.filter(
        (p) =>
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      ).length,
      totalProjectCount: o.projects.length,
      openApplicationCount: o.applications.filter((a) =>
        (OPEN_APPLICATION_STATUSES as readonly string[]).includes(a.status),
      ).length,
      archived: o.archivedAt !== null,
    })),
  );

  return { rows, canEdit, showArchived };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create organizations." };
  }

  const form = await request.formData();
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const website = normalizeWebsite(form.get("website") as string | null);
  const isIndividual = form.get("isIndividual") === "on";
  const firstContactEmail =
    (form.get("firstContactEmail") as string | null)?.trim() || null;

  if (!name) return { error: "A name is required." };

  const org = await prisma.partnerOrg.create({
    data: { name, website, isIndividual },
    select: { id: true },
  });
  await logAuditEvent({
    action: "partner.org.create",
    userId: auth.user.sub,
    targetId: org.id,
    metadata: { via: "core" },
    request,
  });

  // Bridge the "empty org is unreachable" gap: if Core supplied a first
  // contact, send the invite now so the org has a real way in. A bad address
  // doesn't fail creation — land on the org page with the invite panel open so
  // it can be corrected.
  if (firstContactEmail) {
    const invited = await createPartnerInvite(
      {
        partnerOrgId: org.id,
        email: firstContactEmail,
        invitedByUserId: auth.user.sub,
      },
      request,
    );
    if ("error" in invited) return redirect(`/partners/${org.id}?invite=1`);
  }
  return redirect(`/partners/${org.id}`);
}

export default function PartnersOrganizations() {
  const { rows, canEdit, showArchived } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:partners", "list");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav
        items={[
          { label: "Hub", to: "/partners", active: true, icon: LayoutGrid },
          { label: "Applications", to: "/partners/applications", icon: FileText },
        ]}
      />
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Partners
          </h1>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={buttonClasses("primary", "sm")}
          >
            + New organization
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      {creating && canEdit && (
        <Form
          method="post"
          onSubmit={() => setCreating(false)}
          className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            New organization
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Name<span className="text-destructive"> *</span>
              </span>
              <input
                name="name"
                autoFocus
                required
                placeholder="Organization name"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">Website</span>
              <input
                name="website"
                type="url"
                placeholder="https://"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="text-muted-foreground">
                Invite first contact (optional)
              </span>
              <input
                name="firstContactEmail"
                type="email"
                placeholder="contact@company.com"
                className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
              />
              <span className="text-[11px] text-muted-foreground">
                Sends a portal invite so the org has a way in. You can also
                invite later.
              </span>
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input type="checkbox" name="isIndividual" className="rounded" />
              Individual
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button type="submit" className={buttonClasses("primary", "sm")}>
              Create
            </button>
          </div>
        </Form>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by organization name"
          className="flex-1 min-w-[200px] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <ViewToggle value={view} onChange={setView} />
        <Link
          to={showArchived ? "/partners" : "/partners?archived=1"}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length}{" "}
          {filtered.length === 1 ? "organization" : "organizations"}
          {query && filtered.length !== rows.length ? ` of ${rows.length}` : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          {query
            ? "No organizations match this search."
            : "No partner organizations yet."}
        </div>
      ) : view === "list" ? (
        <PartnersTable rows={filtered} />
      ) : (
        <PartnersCards rows={filtered} />
      )}
    </div>
  );
}

function PartnersTable({ rows }: { rows: OrgRow[] }) {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
          <tr>
            <th className="text-left font-medium px-4 py-2">Organization</th>
            <th className="text-left font-medium px-4 py-2">Members</th>
            <th className="text-left font-medium px-4 py-2">Active projects</th>
            <th className="text-left font-medium px-4 py-2">Open applications</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr
              key={o.id}
              onClick={() => {
                const url = `/partners/${o.id}`;
                if (!requestOpenTabIfEmbedded(url, o.name)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2">
                <div className="flex items-center gap-3 min-w-0">
                  <OrgAvatar org={o} />
                  <div className="min-w-0">
                    <span className="font-medium text-foreground truncate block">
                      {o.name}
                    </span>
                    {o.isIndividual && (
                      <span className="text-xs text-muted-foreground">
                        Individual
                      </span>
                    )}
                    {o.archived && (
                      <span className="text-xs text-amber-700 ml-2">Archived</span>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{o.memberCount}</td>
              <td className="px-4 py-2 text-muted-foreground">
                {o.activeProjectCount}
                {o.totalProjectCount > o.activeProjectCount && (
                  <span className="text-xs"> / {o.totalProjectCount} total</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {o.openApplicationCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartnersCards({ rows }: { rows: OrgRow[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {rows.map((o) => (
        <PartnerCard key={o.id} org={o} />
      ))}
    </div>
  );
}

function PartnerCard({ org }: { org: OrgRow }) {
  return (
    <Link
      to={`/partners/${org.id}`}
      className="border border-border rounded-md p-3 bg-background flex items-start gap-3 hover:bg-muted/10 transition-colors"
    >
      <OrgAvatar org={org} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="font-semibold text-foreground truncate">{org.name}</span>
          {org.isIndividual && (
            <span className="text-xs text-muted-foreground">Individual</span>
          )}
          {org.archived && (
            <span className="text-xs text-amber-700">Archived</span>
          )}
        </div>
        <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          <div>
            {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
          </div>
          <div>
            {org.activeProjectCount} active
            {org.totalProjectCount > org.activeProjectCount
              ? ` / ${org.totalProjectCount} total`
              : ""}
          </div>
          {org.openApplicationCount > 0 && (
            <div>
              {org.openApplicationCount} open{" "}
              {org.openApplicationCount === 1 ? "application" : "applications"}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function OrgAvatar({ org }: { org: Pick<OrgRow, "name" | "logoUrl"> }) {
  if (org.logoUrl) {
    return (
      <img
        src={org.logoUrl}
        alt=""
        className="w-8 h-8 rounded object-contain bg-background border border-border flex-shrink-0"
      />
    );
  }
  return (
    <div className="w-8 h-8 rounded bg-brand-tint text-dark-blue flex items-center justify-center text-xs font-bold flex-shrink-0">
      {org.name.slice(0, 1)}
    </div>
  );
}
