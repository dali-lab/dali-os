import { useMemo, useState } from "react";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { useSearchParamChoice } from "~/hooks/useSearchParamState";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.partners.planning";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { setTermPi } from "../lib/partner-renewals.server";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PlanningTable } from "../components/PlanningTable";
import { PlanningProjectModal } from "../components/planning/PlanningProjectModal";
import { ProjectPlanningTable } from "../components/ProjectPlanningTable";
import { loadPlanningData } from "../lib/planning-gap.server";
import { buildPlanningGap, buildPlanningProjects, type IntentSetup } from "../lib/planning-gap";
import { TermFilter } from "~/components/TermFilter";
import { Toggle } from "~/components/ui/Toggle";
import { Tooltip } from "~/components/ui/floating";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

export const handle = { hideBreadcrumbs: true, areaSubnav: true };

export const meta: Route.MetaFunction = () => [{ title: "Partner planning · DALI OS" }];

// Grouping is client side; only the term scopes the loader.
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return skipClientOnlySearchChange(args, ["term"]);
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const termParam = new URL(request.url).searchParams.get("term");
  return loadPlanningData(termParam, request);
}

// Per-term Principal Investigator. Core-only on both sides, matching the
// renewals board — one helper writes the row from either surface so they
// cannot drift.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub, request))) {
    return Response.json({ error: "Only Core can set the project PI." }, { status: 403 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent !== "pi") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const projectId = String(form.get("projectId") ?? "");
  const termId = String(form.get("termId") ?? "");
  const piUserId = String(form.get("piUserId") ?? "") || null;
  if (!projectId || !termId) {
    return Response.json({ error: "Missing project or term." }, { status: 400 });
  }
  if (piUserId && !(await isCore(piUserId, request))) {
    return Response.json({ error: "A PI must be a Core member." }, { status: 400 });
  }
  if (!(await setTermPi(prisma, { projectId, termId, piUserId }))) {
    return Response.json(
      { error: "That project is not active in that term." },
      { status: 400 },
    );
  }
  return Response.json({ ok: true });
}

const GROUP_BY = ["project", "domain"] as const;

export default function PartnersPlanning() {
  const data = useLoaderData<typeof loader>();
  const { os } = useOsChrome();
  const [view, setView] = useSearchParamChoice("group", GROUP_BY, "project");
  const [includePotential, setIncludePotential] = useState(false);
  const [includeBacklog, setIncludeBacklog] = useState(false);
  // The planning rows open this popup instead of navigating away so the planner
  // keeps their filter + scroll position. Only project rows use it; application
  // rows still jump to the Partners board where their card lives.
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const openProject = useMemo(() => {
    if (!openProjectId) return null;
    const match = [...data.items, ...data.listOnlyItems].find(
      (i) => i.kind === "project" && i.refId === openProjectId,
    );
    const info = data.projectInfo[openProjectId];
    if (!match || !info) return null;
    return {
      project: { id: match.refId, name: match.name, iconEmoji: match.iconEmoji ?? null },
      info,
    };
  }, [openProjectId, data.items, data.listOnlyItems, data.projectInfo]);
  const model = useMemo(
    () =>
      buildPlanningGap({
        domains: data.domains,
        items: data.items,
        returning: data.returning,
        includePotential,
        includeBacklog,
      }),
    [data, includePotential, includeBacklog],
  );
  const projectModel = useMemo(
    () =>
      buildPlanningProjects({
        domains: data.domains,
        items: data.items,
        listOnlyItems: data.listOnlyItems,
        includePotential,
        includeBacklog,
      }),
    [data, includePotential, includeBacklog],
  );
  const termCode = data.terms.find((t) => t.id === data.termId)?.code ?? "this term";
  const termHref = data.termId ? `/core/intent-to-work?term=${data.termId}` : "/core/intent-to-work";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <PartnerCrmNav className="shrink-0" />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {view === "domain" && data.hasIntentData && (
            <Link
              to={termHref}
              className={cn("shrink-0 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground", !os && "underline")}
            >
              {data.replied} of {data.roster} replied
            </Link>
          )}
          <SegmentedTabButtons
            label="Group by"
            size="toolbar"
            className="shrink-0"
            items={[
              { label: "Domain", active: view === "domain", onClick: () => setView("domain") },
              { label: "Project", active: view === "project", onClick: () => setView("project") },
            ]}
          />
          <Tooltip content="Adds Backlog applications that target this term">
            <span className="inline-flex h-9 shrink-0 items-center px-1">
              <Toggle
                tone="os"
                label="Include backlog"
                checked={includeBacklog}
                onChange={(e) => setIncludeBacklog(e.target.checked)}
              />
            </span>
          </Tooltip>
          <Tooltip content="Adds New, Interview and Deciding applications and undecided renewals">
            <span className="inline-flex h-9 shrink-0 items-center px-1">
              <Toggle
                tone="os"
                label="Include potential"
                checked={includePotential}
                onChange={(e) => setIncludePotential(e.target.checked)}
              />
            </span>
          </Tooltip>
          {data.termId && (
            <TermFilter
              terms={data.terms}
              selected={data.termId}
              includeAll={false}
              replace
            />
          )}
        </div>
      </div>

      {!data.termId ? (
        <div className="rounded-os-card bg-os-card p-5 text-sm text-muted-foreground">No terms exist yet.</div>
      ) : view === "project" ? (
        <ProjectPlanningTable
          model={projectModel}
          termCode={termCode}
          onProjectClick={setOpenProjectId}
        />
      ) : data.intentSetup.kind !== "ready" ? (
        <div className="rounded-os-card bg-os-card p-5 text-sm text-muted-foreground">
          {intentSetupMessage(data.intentSetup, termCode)}{" "}
          <Link to={termHref} className="text-foreground underline">
            Open intent to work
          </Link>
        </div>
      ) : (
        <PlanningTable model={model} onProjectClick={setOpenProjectId} />
      )}

      {openProject && (
        <PlanningProjectModal
          project={openProject.project}
          info={openProject.info}
          coreMembers={data.coreMembers}
          currentTermId={data.termId}
          canEditPi
          onClose={() => setOpenProjectId(null)}
        />
      )}
    </div>
  );
}

function intentSetupMessage(setup: Exclude<IntentSetup, { kind: "ready" }>, termCode: string): string {
  const responses = (n: number) => `${n} ${n === 1 ? "response" : "responses"}`;
  switch (setup.kind) {
    case "no-form":
      return `No intent to work form is bound for ${termCode}. Bind one in its settings.`;
    case "unmapped":
      return setup.submissions > 0
        ? `${responses(setup.submissions)} for ${termCode}, but the form's status question isn't mapped. Map it in settings and save.`
        : `The ${termCode} intent to work form's status question isn't mapped. Map it in settings and save.`;
    case "no-statuses":
      return `${responses(setup.submissions)} for ${termCode}, but none answered the mapped status question.`;
    case "no-responses":
      return `No intent to work responses for ${termCode} yet.`;
  }
}
