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
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { canViewStaffing, isCore } from "~/lib/roles";
import { logAuditEvent } from "~/lib/audit";
import { resolvePhotoUrl } from "~/lib/photo";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { AreaPillNav } from "~/components/AreaPillNav";
import { ViewToggle, useViewPreference } from "~/components/ViewToggle";
import { buttonClasses } from "~/components/ui/Button";
import { OPEN_APPLICATION_STATUSES } from "../lib/partner-application";
import { FileText, LayoutGrid, Plus } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { cn } from "~/lib/cn";
import { useFeatureFlag } from "~/components/FeatureFlags";

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
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const now = new Date();
  const [orgs, openInquiryCount, canEdit] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        website: true,
        isIndividual: true,
        // Active members only. Reads `memberships` (account-first), NOT the
        // retired `users`/PartnerUser relation — which no longer gets rows.
        memberships: { where: { endedAt: null }, select: { id: true } },
        projects: {
          select: {
            startedAt: true,
            endedAt: true,
            project: { select: { status: true } },
          },
        },
      },
    }),
    // Open inquiries are org-independent until promotion (partnerOrgId is null
    // through the funnel), so this is a single lab-wide count for the pipeline
    // entry point rather than a per-org number.
    prisma.partnerApplication.count({
      where: { status: { in: OPEN_APPLICATION_STATUSES } },
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
      memberCount: o.memberships.length,
      activeProjectCount: o.projects.filter(
        (p) =>
          p.project.status !== "Archived" &&
          (p.startedAt === null || p.startedAt <= now) &&
          (p.endedAt === null || p.endedAt > now),
      ).length,
      totalProjectCount: o.projects.length,
    })),
  );

  return { rows, openInquiryCount, canEdit };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to create organizations." };
  }

  const form = await request.formData();
  const name = (form.get("name") as string | null)?.trim() ?? "";
  const website = (form.get("website") as string | null)?.trim() || null;
  const isIndividual = form.get("isIndividual") === "on";

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
  return redirect(`/partners/${org.id}`);
}

export default function PartnersOrganizations() {
  const { rows, openInquiryCount, canEdit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useViewPreference("dali:view:partners", "list");
  // Same dress the dali.os projects hub and people directory wear — scaled
  // title, pill toolbar, the design's plus button. Chrome only; both views
  // and every control stay exactly as they are.
  const os = useFeatureFlag("os-redesign");

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
          <h1
            className={cn(
              "font-heading text-foreground",
              os ? "text-4xl font-medium" : "text-2xl font-bold",
            )}
          >
            Partners
          </h1>
        </div>
        {canEdit && !creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className={os ? "os-add-btn" : buttonClasses("primary", "sm")}
          >
            {os ? (
              <>
                <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
                New organization
              </>
            ) : (
              "+ New organization"
            )}
          </button>
        )}
      </header>

      {actionData?.error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {actionData.error}
        </div>
      )}

      <Link
        to="/partners/applications"
        className="group flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent-coral/40 hover:bg-muted/10"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-tint text-dark-blue">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold text-foreground">
              Application pipeline
            </div>
            <div className="text-sm text-muted-foreground">
              Track inquiries from first contact through to a project.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {openInquiryCount} open{" "}
            {openInquiryCount === 1 ? "inquiry" : "inquiries"}
          </span>
          <span className="text-accent-coral transition-transform group-hover:translate-x-0.5">
            →
          </span>
        </div>
      </Link>

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
            <Checkbox
              name="isIndividual"
              label="Individual"
              className="text-sm text-foreground sm:col-span-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className={os ? "os-btn-ghost" : buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={os ? "os-btn-primary" : buttonClasses("primary", "sm")}
            >
              Create
            </button>
          </div>
        </Form>
      )}

      <div className={cn("flex items-center gap-3 flex-wrap", os && "gap-4 pt-2 pb-4")}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by organization name"
          className={cn(
            "flex-1 min-w-[200px] text-sm border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30",
            os
              ? "max-w-[420px] px-5 py-2.5 rounded-full bg-card"
              : "max-w-sm px-3 py-2 rounded-md bg-background",
          )}
        />
        <ViewToggle value={view} onChange={setView} />
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
