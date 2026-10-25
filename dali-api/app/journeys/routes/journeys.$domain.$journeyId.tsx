import { useEffect, useMemo, useState } from "react";
import { Link, redirect, useFetcher } from "react-router";
import { ArrowRight, Pencil, PartyPopper, RotateCcw } from "lucide-react";
import type { Route } from "./+types/journeys.$domain.$journeyId";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { JourneyGraph } from "~/journeys/components/graph/JourneyGraph";
import { ProgressBar } from "~/journeys/components/JourneyCards";
import { ModulePreviewPanel } from "~/journeys/components/ModulePreviewPanel";
import { findDomain, loadLearnerJourney, requireJourneyViewer, toDomain } from "~/journeys/lib/journeys.server";
import { progressAction } from "~/journeys/lib/progress-action.server";
import { getJourneyProgress, journeyTitle, nextAvailableModule } from "~/journeys/lib/journey";
import { domainPath, editPath, journeyPath, JOURNEYS_HOME } from "~/journeys/lib/paths";
import { AccessButton } from "~/journeys/components/AccessDialog";
import { BackLink } from "~/journeys/components/BackLink";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data ? journeyTitle(data.journey) : "Journey"} · DALI OS` },
];

export const handle = { fitViewport: true, hideBreadcrumbs: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw redirect(JOURNEYS_HOME);
  const slug = toDomain(domain).slug;
  const found = await loadLearnerJourney(viewer, domain.id, params.journeyId);
  if (!found) throw redirect(domainPath(slug));
  return { domain: toDomain(domain), ...found };
}

export async function action({ request, params }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  return progressAction(request, viewer, params.journeyId);
}

const LEGEND = [
  { label: "Completed", dot: "bg-os-green" },
  { label: "Ready", dot: "bg-os-accent" },
  { label: "Locked", dot: "border border-os-muted" },
];

export default function JourneyMap({ loaderData }: Route.ComponentProps) {
  const { domain, journey, role, creator, completed: completedKeys } = loaderData;
  const { pageTitle, bodyText } = useOsChrome();
  const dialog = useDialog();
  const reset = useFetcher();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => setSelectedId(null), [journey.id]);

  const completed = useMemo(() => new Set(completedKeys), [completedKeys]);
  const basePath = journeyPath(domain.slug, journey.id);
  const { done, total } = getJourneyProgress(journey, completed);
  const next = nextAvailableModule(journey, completed);
  const selected = journey.modules.find((m) => m.id === selectedId) ?? null;

  const handleReset = async () => {
    const ok = await dialog.confirm({
      title: "Reset your progress?",
      description: `Every module in ${journeyTitle(journey)} goes back to not started.`,
      confirmLabel: "Reset",
      tone: "destructive",
    });
    if (ok) reset.submit({ intent: "reset" }, { method: "post" });
  };

  return (
    <div className="flex min-h-[720px] flex-1 flex-col gap-6 md:min-h-0">
      <header className="flex shrink-0 flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <BackLink to={domainPath(domain.slug)}>{`${domain.name} journeys`}</BackLink>
            <h1 className={cn(pageTitle, "mt-2")}>{journeyTitle(journey)}</h1>
            {journey.description && <p className={cn(bodyText, "mt-2")}>{journey.description}</p>}
            {creator && <p className="mt-2 text-sm text-os-muted">Created by {creator}</p>}
          </div>
          {role && (
            <div className="flex shrink-0 items-center gap-2">
              <Link to={editPath(domain.slug, journey.id)} className={buttonClasses("secondary", "sm")}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit journey
              </Link>
              <AccessButton journeyId={journey.id} variant="button" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="w-60">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-os-grey">
                <span className="font-semibold tabular-nums text-foreground">{done}</span> of {total} complete
              </span>
              {done > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={reset.state !== "idle"}
                  className="inline-flex items-center gap-1 text-xs text-os-muted transition-colors hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                  Reset
                </button>
              )}
            </div>
            <ProgressBar done={done} total={total} label={`${journeyTitle(journey)} progress`} className="mt-2" />
          </div>
          {next ? (
            <Link to={`${basePath}/${next.id}`} className={buttonClasses("primary", "md", "max-w-xs")}>
              <span className="truncate">Continue: {next.title}</span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-2 text-sm font-medium text-os-green">
              <PartyPopper className="h-4 w-4" aria-hidden />
              Journey complete
            </span>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-4">
        <div className="relative min-h-[460px] flex-1 overflow-hidden rounded-os-card bg-os-well">
          <JourneyGraph journey={journey} completed={completed} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-4 rounded-full bg-os-bg/90 px-4 py-2 text-xs text-os-grey">
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className={cn("h-2 w-2 rounded-full", l.dot)} aria-hidden />
                {l.label}
              </span>
            ))}
          </div>
        </div>
        {selected && (
          <ModulePreviewPanel
            key={selected.id}
            basePath={basePath}
            journey={journey}
            module={selected}
            completed={completed}
            onSelect={setSelectedId}
          />
        )}
      </div>
    </div>
  );
}
