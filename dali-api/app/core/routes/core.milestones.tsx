import { redirect, Form, Link, useLoaderData } from "react-router";
import { Plus, Milestone as MilestoneIcon, Globe } from "lucide-react";
import type { Route } from "./+types/core.milestones";
import { requireCore } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { coreHandle } from "~/core/coreNav";
import { MilestonesSubnav } from "~/core/components/MilestonesSubnav";
import {
  ensureLabMilestoneSet,
  listMilestoneSets,
  createMilestoneSet,
} from "~/lib/milestones.server";
import { coerceEntries } from "~/lib/milestones";

export const meta: Route.MetaFunction = () => [{ title: "Milestones · DALI OS" }];

export const handle = coreHandle("milestones");

export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  // Seed the one Lab set on first open (like loadTimeline seeds the timeline).
  await ensureLabMilestoneSet(gate.auth.user.sub);
  const sets = await listMilestoneSets();

  return {
    sets: sets.map((s) => {
      const latest = s.versions[0];
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        isLabWide: s.isLabWide,
        versionCount: s._count.versions,
        latestVersionNumber: latest?.versionNumber ?? null,
        milestoneCount: latest ? coerceEntries(latest.entries).length : 0,
        createdBy: [s.createdBy?.firstName, s.createdBy?.lastName].filter(Boolean).join(" "),
      };
    }),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  const formData = await request.formData();
  if (formData.get("intent") === "create") {
    const name = ((formData.get("name") as string) || "").trim() || "Untitled set";
    const description = ((formData.get("description") as string) || "").trim() || null;
    const set = await createMilestoneSet({
      name,
      description,
      createdById: gate.auth.user.sub,
    });
    return redirect(`/core/milestones/${set.id}`);
  }
  return null;
}

export default function CoreMilestones() {
  const { sets } = useLoaderData<typeof loader>();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Milestones</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Reusable, versioned week-by-week milestone sets. Author a set here, then
          assign it to projects at term setup — it renders on each project&apos;s
          timeline next to its sprints. The lab-wide set&apos;s events show on every
          project&apos;s timeline.
        </p>
      </header>

      <MilestonesSubnav active="sets" />

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground/80">New set</h2>
        <Form method="post" className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="create" />
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1 block text-xs font-medium text-foreground/70">Name</label>
            <input
              name="name"
              required
              placeholder="e.g. Returning teams"
              className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </div>
          <div className="min-w-[16rem] flex-[2]">
            <label className="mb-1 block text-xs font-medium text-foreground/70">
              Description (optional)
            </label>
            <input
              name="description"
              placeholder="Who this set is for"
              className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center rounded-lg bg-accent-coral px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-coral/90"
          >
            <Plus className="mr-2 h-4 w-4" />
            Create
          </button>
        </Form>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sets.map((s) => (
          <Link
            key={s.id}
            to={`/core/milestones/${s.id}`}
            prefetch="intent"
            className="group flex flex-col rounded-xl border border-border bg-card p-4 shadow-sm transition hover:border-accent-coral/50 hover:shadow-brand-1"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="inline-flex items-center gap-2 font-heading font-semibold text-foreground">
                <MilestoneIcon className="h-4 w-4 flex-shrink-0 text-accent-coral" aria-hidden />
                {s.name}
              </h3>
              {s.isLabWide && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-coral/10 px-2 py-0.5 text-[11px] font-medium text-accent-coral">
                  <Globe className="h-3 w-3" aria-hidden />
                  Lab-wide
                </span>
              )}
            </div>
            {s.description && (
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              {s.versionCount === 0
                ? "No versions yet"
                : `v${s.latestVersionNumber} · ${s.milestoneCount} milestone${s.milestoneCount === 1 ? "" : "s"}`}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
