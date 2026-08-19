import { redirect, useFetcher, useLoaderData, useSubmit } from "react-router";
import { Milestone as MilestoneIcon, Globe } from "lucide-react";
import type { Route } from "./+types/core.milestones.assign";
import { requireCore } from "~/lib/auth";
import { getUserRoles, currentTerm } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { prisma } from "~/lib/db";
import { coreHandle } from "~/core/coreNav";
import { MilestonesSubnav } from "~/core/components/MilestonesSubnav";
import { PageIcon } from "~/components/PageIcon";
import {
  assignableSets,
  termProjectsWithAssignment,
  assignMilestoneSet,
  unassignMilestoneSet,
} from "~/lib/milestones.server";

export const meta: Route.MetaFunction = () => [{ title: "Assign milestones · DALI OS" }];

export const handle = coreHandle("milestones");

export async function loader({ request }: Route.LoaderArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  const terms = await prisma.term.findMany({
    orderBy: { sortKey: "desc" },
    select: { id: true, code: true },
  });
  const current = await currentTerm(request);
  const termId =
    new URL(request.url).searchParams.get("term") || current?.id || terms[0]?.id || null;

  const [sets, projects] = termId
    ? await Promise.all([assignableSets(), termProjectsWithAssignment(termId)])
    : [[], []];

  return { terms, termId, sets, projects };
}

export async function action({ request }: Route.ActionArgs) {
  const gate = await requireCore(request);
  if (!gate.ok) return gate.response;
  const roles = await getUserRoles(gate.auth.user.sub, request);
  if (!(await isFeatureEnabled("milestones-v2", gate.auth.user.sub, roles, request))) {
    return redirect("/core");
  }

  const formData = await request.formData();
  const projectId = (formData.get("projectId") as string) || "";
  const termId = (formData.get("termId") as string) || "";
  const setId = (formData.get("setId") as string) || "";
  if (!projectId || !termId) return { ok: false };

  if (setId) {
    await assignMilestoneSet({ projectId, termId, setId, assignedById: gate.auth.user.sub });
  } else {
    await unassignMilestoneSet({ projectId, termId });
  }
  return { ok: true };
}

type AssignSet = {
  id: string;
  name: string;
  isLabWide: boolean;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
};
type AssignProject = {
  id: string;
  name: string;
  iconEmoji: string | null;
  assignedSetId: string | null;
  assignedSetName: string | null;
  assignedVersionNumber: number | null;
};

function AssignRow({
  project,
  termId,
  sets,
}: {
  project: AssignProject;
  termId: string;
  sets: AssignSet[];
}) {
  const fetcher = useFetcher();
  // Optimistic: reflect the in-flight select value while the fetcher runs.
  const pending = fetcher.formData?.get("setId");
  const value = pending !== undefined && pending !== null ? String(pending) : project.assignedSetId ?? "";

  return (
    <tr className="border-b border-border/60 last:border-b-0">
      <td className="px-4 py-2">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
          <PageIcon iconEmoji={project.iconEmoji} />
          {project.name}
        </span>
      </td>
      <td className="px-4 py-2">
        <fetcher.Form method="post" className="flex items-center gap-2">
          <input type="hidden" name="projectId" value={project.id} />
          <input type="hidden" name="termId" value={termId} />
          <select
            name="setId"
            value={value}
            onChange={(e) => fetcher.submit(e.currentTarget.form)}
            className="min-w-[14rem] rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            <option value="">— None —</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id} disabled={s.latestVersionId === null}>
                {s.name}
                {s.isLabWide ? " (lab-wide)" : ""}
                {s.latestVersionId === null ? " — no version yet" : ` · v${s.latestVersionNumber}`}
              </option>
            ))}
          </select>
          {fetcher.state !== "idle" && (
            <span className="text-xs text-muted-foreground">Saving…</span>
          )}
        </fetcher.Form>
      </td>
    </tr>
  );
}

export default function AssignMilestones() {
  const { terms, termId, sets, projects } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Milestones</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Assign a milestone set to each project for the term. The pinned version
          freezes so it can&apos;t change under a project mid-term. The lab-wide set
          shows on every project regardless of what you pick here.
        </p>
      </header>

      <MilestonesSubnav active="assign" />

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-foreground/70">Term</label>
        <select
          value={termId ?? ""}
          onChange={(e) => submit({ term: e.currentTarget.value }, { method: "get" })}
          className="rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        >
          {terms.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code}
            </option>
          ))}
        </select>
      </div>

      {projects.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No active projects in this term.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Milestone set</th>
              </tr>
            </thead>
            <tbody className="px-4">
              {projects.map((p) => (
                <AssignRow key={p.id} project={p} termId={termId!} sets={sets} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sets.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No milestone sets yet — create one on the Sets tab first.
        </p>
      )}
    </div>
  );
}
