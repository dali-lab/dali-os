import { useCallback, useMemo, useState } from "react";
import type { ShouldRevalidateFunctionArgs } from "react-router";
import { skipClientOnlySearchChange } from "~/lib/should-revalidate";
import { useSearchParamChoice } from "~/hooks/useSearchParamState";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/core.partners.planning";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import { prisma } from "~/lib/db.server";
import { setMaintenancePlan, setTermPi } from "../lib/partner-renewals.server";
import { isMaintenancePlan } from "../lib/partner-renewals";
import { setApplicationSpots, setTermSpots } from "../lib/planning-spots.server";
import { PLANNING_NOTE_MAX, setPlanningNote } from "../lib/planning-notes.server";
import { startProjectReturn } from "../lib/partner-returns.server";
import { PartnerCrmNav } from "../components/PartnerCrmNav";
import { PlanningTable } from "../components/PlanningTable";
import { PlanningProjectModal } from "../components/planning/PlanningProjectModal";
import { PlanningApplicationModal } from "../components/planning/PlanningApplicationModal";
import { StartReturnModal } from "../components/planning/StartReturnModal";
import { Button } from "~/components/ui/Button";
import { ProjectPlanningTable } from "../components/ProjectPlanningTable";
import { loadPlanningData } from "../lib/planning-gap.server";
import { buildPlanningGap, buildPlanningProjects, findPlanningProject, type IntentSetup } from "../lib/planning-gap";
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

const DESCRIPTION_MAX = 5000;

const START_RETURN_ERRORS = {
  "not-found": "That project no longer exists.",
  "no-terms": "Pick at least one term for the return.",
  "no-contact": "This project has no partner contact to carry over. Add one in the Directory first.",
  "already-open": "This project already has an open return on the partner board.",
} as const;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub, request))) {
    return Response.json({ error: "Only Core can edit projects from planning." }, { status: 403 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "start-return") {
    const result = await startProjectReturn({
      projectId: String(form.get("projectId") ?? ""),
      targetTermIds: form.getAll("targetTermId").map(String),
      actorUserId: auth.user.sub,
    });
    if (result.ok) return Response.json({ ok: true, applicationId: result.applicationId });
    return Response.json({ error: START_RETURN_ERRORS[result.error] }, { status: result.error === "not-found" ? 404 : 400 });
  }

  if (intent === "note") {
    const ownerKind = String(form.get("ownerKind") ?? "");
    const ownerId = String(form.get("ownerId") ?? "");
    if (!ownerId || (ownerKind !== "project" && ownerKind !== "application")) {
      return Response.json({ error: "Missing project or application." }, { status: 400 });
    }
    const body = String(form.get("body") ?? "");
    if (body.trim().length > PLANNING_NOTE_MAX) {
      return Response.json({ error: `Keep the note under ${PLANNING_NOTE_MAX} characters.` }, { status: 400 });
    }
    const owner = ownerKind === "project" ? { projectId: ownerId } : { applicationId: ownerId };
    const result = await setPlanningNote(prisma, { owner, body, userId: auth.user.sub });
    if (result === "not-found") {
      return Response.json({ error: `That ${ownerKind} no longer exists.` }, { status: 404 });
    }
    return Response.json({ ok: true });
  }

  if (intent === "application-summary" || intent === "application-pi" || intent === "application-spots") {
    const applicationId = String(form.get("applicationId") ?? "");
    if (!applicationId) return Response.json({ error: "Missing application." }, { status: 400 });
    const gone = Response.json({ error: "That application no longer exists." }, { status: 404 });

    if (intent === "application-summary") {
      const summary = String(form.get("summary") ?? "").trim();
      if (summary.length > DESCRIPTION_MAX) {
        return Response.json({ error: `Keep the summary under ${DESCRIPTION_MAX} characters.` }, { status: 400 });
      }
      const { count } = await prisma.partnerApplication.updateMany({
        where: { id: applicationId },
        data: { summary: summary || null },
      });
      return count === 0 ? gone : Response.json({ ok: true });
    }

    if (intent === "application-pi") {
      const piUserId = String(form.get("piUserId") ?? "") || null;
      if (piUserId && !(await isCore(piUserId, request))) {
        return Response.json({ error: "A PI must be a Core member." }, { status: 400 });
      }
      const { count } = await prisma.partnerApplication.updateMany({
        where: { id: applicationId },
        data: { piUserId },
      });
      return count === 0 ? gone : Response.json({ ok: true });
    }

    const roles = parseRoles(form.get("roles"));
    if (!roles) return Response.json({ error: "Spots were not readable. Try again." }, { status: 400 });
    const result = await setApplicationSpots(prisma, { applicationId, roles });
    if (result === "not-found") return gone;
    if (result === "unknown-domain") {
      return Response.json({ error: "One of those domains is no longer available." }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) return Response.json({ error: "Missing project." }, { status: 400 });

  if (intent === "maintenance-plan") {
    const plan = form.get("plan");
    if (!isMaintenancePlan(plan)) return Response.json({ error: "Pick a maintenance plan." }, { status: 400 });
    const result = await setMaintenancePlan(prisma, { projectId, plan });
    if (result === "not-on-plan") {
      return Response.json({ error: "This project is not on a maintenance plan." }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  if (intent === "description") {
    const description = String(form.get("description") ?? "").trim();
    if (description.length > DESCRIPTION_MAX) {
      return Response.json({ error: `Keep the description under ${DESCRIPTION_MAX} characters.` }, { status: 400 });
    }
    const { count } = await prisma.project.updateMany({
      where: { id: projectId },
      data: { description: description || null },
    });
    if (count === 0) return Response.json({ error: "That project no longer exists." }, { status: 404 });
    return Response.json({ ok: true });
  }

  const termId = String(form.get("termId") ?? "");
  if (!termId) return Response.json({ error: "Missing project or term." }, { status: 400 });

  if (intent === "spots") {
    const roles = parseRoles(form.get("roles"));
    if (!roles) return Response.json({ error: "Spots were not readable. Try again." }, { status: 400 });
    const result = await setTermSpots(prisma, { projectId, termId, roles });
    if (result === "unknown-domain") {
      return Response.json({ error: "One of those domains is no longer available." }, { status: 400 });
    }
    if (result === "not-in-term") {
      return Response.json({ error: "That project is not active in that term." }, { status: 400 });
    }
    return Response.json({ ok: true });
  }

  if (intent !== "pi") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const piUserId = String(form.get("piUserId") ?? "") || null;
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

function parseRoles(raw: FormDataEntryValue | null): { domainId: string; slots: number }[] | null {
  try {
    const parsed: unknown = JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(parsed)) return null;
    const roles = parsed.map((r) => ({
      domainId: typeof r?.domainId === "string" ? r.domainId : "",
      slots: Number(r?.slots),
    }));
    return roles.every((r) => r.domainId && Number.isFinite(r.slots) && r.slots >= 0 && r.slots <= 50)
      ? roles
      : null;
  } catch {
    return null;
  }
}

const GROUP_BY = ["project", "domain"] as const;

export default function PartnersPlanning() {
  const data = useLoaderData<typeof loader>();
  const { os } = useOsChrome();
  const [view, setView] = useSearchParamChoice("group", GROUP_BY, "project");
  const [includePotential, setIncludePotential] = useState(false);
  const [includeBacklog, setIncludeBacklog] = useState(false);
  const [openRow, setOpenRow] = useState<{ kind: "project" | "application"; id: string } | null>(null);
  const openRowClick = (kind: "project" | "application", id: string) => setOpenRow({ kind, id });
  const openProjectId = openRow?.kind === "project" ? openRow.id : null;
  const openApplicationId = openRow?.kind === "application" ? openRow.id : null;
  const openApplication = openApplicationId ? data.applicationInfo[openApplicationId] ?? null : null;
  const [startingReturn, setStartingReturn] = useState(false);
  const pickedTermIndex = data.terms.findIndex((t) => t.id === data.termId);
  const returnTerms = pickedTermIndex < 0 ? [] : data.terms.slice(0, pickedTermIndex + 1).reverse();
  const onReturnCreated = useCallback((applicationId: string) => {
    setStartingReturn(false);
    setOpenRow({ kind: "application", id: applicationId });
  }, []);
  const openProject = useMemo(() => {
    if (!openProjectId) return null;
    const match = findPlanningProject(openProjectId, [...data.items, ...data.listOnlyItems], data.maintaining);
    const info = data.projectInfo[openProjectId];
    if (!match || !info) return null;
    return { project: match, info };
  }, [openProjectId, data.items, data.listOnlyItems, data.maintaining, data.projectInfo]);
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
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => setStartingReturn(true)}>
              Start a return
            </Button>
          )}
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
          onRowClick={openRowClick}
          maintaining={data.maintaining}
        />
      ) : data.intentSetup.kind !== "ready" ? (
        <div className="rounded-os-card bg-os-card p-5 text-sm text-muted-foreground">
          {intentSetupMessage(data.intentSetup, termCode)}{" "}
          <Link to={termHref} className="text-foreground underline">
            Open intent to work
          </Link>
        </div>
      ) : (
        <PlanningTable model={model} onRowClick={openRowClick} />
      )}

      {openProject && (
        <PlanningProjectModal
          project={openProject.project}
          info={openProject.info}
          coreMembers={data.coreMembers}
          domains={data.spotDomains}
          currentTermId={data.termId}
          canEdit
          onClose={() => setOpenRow(null)}
        />
      )}
      {startingReturn && data.termId && (
        <StartReturnModal
          projects={data.returnableProjects}
          terms={returnTerms}
          defaultTermId={data.termId}
          onCreated={onReturnCreated}
          onClose={() => setStartingReturn(false)}
        />
      )}
      {openApplicationId && openApplication && (
        <PlanningApplicationModal
          applicationId={openApplicationId}
          info={openApplication}
          coreMembers={data.coreMembers}
          domains={data.spotDomains}
          canEdit
          onClose={() => setOpenRow(null)}
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
