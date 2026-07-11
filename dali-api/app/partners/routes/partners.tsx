import { useState } from "react";
import {
  Form,
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
import { OPEN_APPLICATION_STATUSES } from "../lib/partner-application";

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
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const now = new Date();
  const [orgs, canEdit] = await Promise.all([
    prisma.partnerOrg.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        logoUrl: true,
        website: true,
        isIndividual: true,
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

  const rows: OrgRow[] = await Promise.all(orgs.map(async (o) => ({
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
  })));

  return { rows, canEdit };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
  const { rows, canEdit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Organizations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Partner organizations, their people, and the projects they fund.
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating((c) => !c)}
            className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
          >
            + New organization
          </button>
        )}
      </div>

      {creating && canEdit && (
        <Form
          method="post"
          className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-end gap-4"
        >
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input
              name="name"
              required
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Website (optional)
            </label>
            <input
              name="website"
              type="url"
              placeholder="https://"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground pb-2">
            <input type="checkbox" name="isIndividual" className="rounded" />
            Individual
          </label>
          <button
            type="submit"
            className="rounded-lg bg-dark-blue text-white text-sm font-medium px-4 py-2 hover:opacity-90 transition"
          >
            Create
          </button>
          {actionData && "error" in actionData && (
            <p className="w-full text-sm text-destructive">{actionData.error}</p>
          )}
        </Form>
      )}

      {rows.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-sm text-muted-foreground">
          No partner organizations yet.
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-muted/30 text-muted-foreground text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left font-medium px-4 py-3">Organization</th>
                <th className="text-left font-medium px-4 py-3">Members</th>
                <th className="text-left font-medium px-4 py-3">Active projects</th>
                <th className="text-left font-medium px-4 py-3">Open applications</th>
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
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {o.logoUrl ? (
                        <img
                          src={o.logoUrl}
                          alt=""
                          className="w-8 h-8 rounded object-contain bg-background border border-border flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded bg-brand-tint text-dark-blue flex items-center justify-center text-xs font-bold flex-shrink-0">
                          {o.name.slice(0, 1)}
                        </div>
                      )}
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
                  <td className="px-4 py-3 text-muted-foreground">{o.memberCount}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {o.activeProjectCount}
                    {o.totalProjectCount > o.activeProjectCount && (
                      <span className="text-xs"> / {o.totalProjectCount} total</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {o.openApplicationCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
