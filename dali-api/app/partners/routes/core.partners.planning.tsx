import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.partners.planning";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PlanningTable } from "../components/PlanningTable";
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

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  if (!(await isCore(auth.user.sub))) return redirect("/");
  const termParam = new URL(request.url).searchParams.get("term");
  return loadPlanningData(termParam);
}

export default function PartnersPlanning() {
  const data = useLoaderData<typeof loader>();
  const { os } = useOsChrome();
  const [view, setView] = useState<"domain" | "project">("domain");
  const [includePotential, setIncludePotential] = useState(false);
  const [includeBacklog, setIncludeBacklog] = useState(false);
  const model = useMemo(
    () =>
      buildPlanningGap({
        domains: data.domains,
        items: data.items,
        returning: data.returning,
        includePotential,
      }),
    [data, includePotential],
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
            size="sm"
            className="shrink-0"
            items={[
              { label: "Domain", active: view === "domain", onClick: () => setView("domain") },
              { label: "Project", active: view === "project", onClick: () => setView("project") },
            ]}
          />
          {view === "project" && (
            <Tooltip content="Adds Backlog applications that target this term">
              <span className="inline-flex h-9 shrink-0 items-center rounded-lg border border-os-container bg-os-card px-3">
                <Toggle
                  tone="os"
                  label="Include backlog"
                  checked={includeBacklog}
                  onChange={(e) => setIncludeBacklog(e.target.checked)}
                />
              </span>
            </Tooltip>
          )}
          <Tooltip content="Adds New, Interview and Deciding applications and undecided renewals">
            <span className="inline-flex h-9 shrink-0 items-center rounded-lg border border-os-container bg-os-card px-3">
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
        <ProjectPlanningTable model={projectModel} termCode={termCode} />
      ) : data.intentSetup.kind !== "ready" ? (
        <div className="rounded-os-card bg-os-card p-5 text-sm text-muted-foreground">
          {intentSetupMessage(data.intentSetup, termCode)}{" "}
          <Link to={termHref} className="text-foreground underline">
            Open intent to work
          </Link>
        </div>
      ) : (
        <PlanningTable model={model} />
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
