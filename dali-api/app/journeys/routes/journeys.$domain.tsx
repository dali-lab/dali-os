import { useMemo } from "react";
import { data, Form, Link, redirect, useNavigate, useNavigation } from "react-router";
import { Inbox, Plus } from "lucide-react";
import type { Route } from "./+types/journeys.$domain";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { countWaitingReviews, isJourneyMentor } from "~/journeys/lib/studio.server";
import { OsTabBar } from "~/components/os-page";
import { cn } from "~/lib/cn";
import { JourneyFeatureCard, JourneyInProgressCard, JourneyRow } from "~/journeys/components/JourneyCards";
import {
  canCreateIn,
  createJourney,
  findDomain,
  loadDomainJourneys,
  loadJourneyTabs,
  requireJourneyViewer,
  toDomain,
} from "~/journeys/lib/journeys.server";
import { getJourneyProgress } from "~/journeys/lib/journey";
import { domainPath, editPath, journeyPath, JOURNEYS_HOME } from "~/journeys/lib/paths";
import type { Journey } from "~/journeys/lib/types";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: `${data?.domain.name ?? "Onboarding"} journeys · DALI OS` },
];

export const handle = { hideBreadcrumbs: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const row = await findDomain(params.domain);
  if (!row) throw redirect(JOURNEYS_HOME);
  const [{ tabs }, journeys, mentor] = await Promise.all([
    loadJourneyTabs(viewer),
    loadDomainJourneys(viewer, row.id),
    isJourneyMentor(viewer),
  ]);
  const domain = { id: row.id, ...toDomain(row) };
  const tabList = tabs.some((t) => t.id === row.id) ? tabs : [...tabs, row];
  return {
    domain,
    tabs: tabList.map(toDomain),
    ...journeys,
    canCreate: canCreateIn(viewer, row.id),
    waitingReviews: mentor ? await countWaitingReviews(viewer) : null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw new Response("Not found", { status: 404 });
  const form = await request.formData();
  if (form.get("intent") !== "create") return data({ error: "Unknown action." }, { status: 400 });
  const result = await createJourney(viewer, domain.id);
  if (!result.ok) return data({ error: result.error }, { status: result.status });
  throw redirect(editPath(toDomain(domain).slug, result.id));
}

type JourneyState = "in-progress" | "new" | "completed";

export default function DomainJourneys({ loaderData }: Route.ComponentProps) {
  const { domain, tabs, published, drafts, progress, canCreate, waitingReviews } = loaderData;
  const { pageTitle } = useOsChrome();
  const navigate = useNavigate();
  const creating = useNavigation().formData?.get("intent") === "create";

  const completedFor = useMemo(() => {
    const sets = new Map<string, Set<string>>();
    for (const [id, p] of Object.entries(progress)) sets.set(id, new Set(p.completed));
    return (id: string) => sets.get(id) ?? new Set<string>();
  }, [progress]);

  const stateOf = (j: Journey): JourneyState => {
    const { done, total } = getJourneyProgress(j, completedFor(j.id));
    if (total > 0 && done === total) return "completed";
    return j.id in progress ? "in-progress" : "new";
  };

  const journeys = published.map((s) => s.journey);
  const creators = new Map([...published, ...drafts].map((s) => [s.journey.id, { creator: s.creator }]));
  const inProgress = journeys.filter((j) => stateOf(j) === "in-progress");
  const notStarted = journeys
    .filter((j) => stateOf(j) === "new")
    .sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
  const finished = journeys.filter((j) => stateOf(j) === "completed");
  const featured = notStarted[0]?.recommended ? notStarted[0] : undefined;
  const otherNew = featured ? notStarted.slice(1) : notStarted;
  const href = (j: Journey) => journeyPath(domain.slug, j.id);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6">
        <div>
          <p className="text-sm text-os-grey">Onboarding</p>
          <h1 className={cn(pageTitle, "mt-1")}>{domain.name} journeys</h1>
        </div>
        <OsTabBar
          ariaLabel="Domains"
          tabs={tabs.map((t) => ({ key: t.slug, label: t.name }))}
          active={domain.slug}
          onSelect={(slug) => navigate(domainPath(slug))}
          trailing={
            waitingReviews !== null && (
              <Link to={`${JOURNEYS_HOME}/reviews`} className={buttonClasses("secondary", "sm")}>
                <Inbox className="h-3.5 w-3.5" aria-hidden />
                Reviews
                {waitingReviews > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-os-accent px-1.5 text-[11px] font-bold text-os-bg">
                    {waitingReviews}
                  </span>
                )}
              </Link>
            )
          }
        />
      </header>

      {journeys.length === 0 && <p className="text-os-grey">No journeys have been published for {domain.name} yet.</p>}

      {inProgress.length > 0 && (
        <section aria-labelledby="in-progress-heading">
          <h2 id="in-progress-heading" className="text-sm font-medium text-os-grey">
            Continue where you left off
          </h2>
          <div className={cn("mt-3 grid gap-4", inProgress.length > 1 && "md:grid-cols-2")}>
            {inProgress.map((j) => (
              <JourneyInProgressCard key={j.id} journey={j} href={href(j)} completed={completedFor(j.id)} {...creators.get(j.id)} />
            ))}
          </div>
        </section>
      )}

      {featured && <JourneyFeatureCard journey={featured} href={href(featured)} {...creators.get(featured.id)} />}

      {otherNew.length > 0 && (
        <section aria-labelledby="not-started-heading">
          <h2 id="not-started-heading" className="text-sm font-medium text-os-grey">
            {featured ? `More ${domain.name} journeys` : "Not started yet"}
          </h2>
          <ul className="mt-1 divide-y divide-os-container">
            {otherNew.map((j) => (
              <JourneyRow key={j.id} journey={j} href={href(j)} variant="new" {...creators.get(j.id)} />
            ))}
          </ul>
        </section>
      )}

      {finished.length > 0 && (
        <section aria-labelledby="completed-heading">
          <h2 id="completed-heading" className="text-sm font-medium text-os-grey">
            Completed
          </h2>
          <ul className="mt-1 divide-y divide-os-container">
            {finished.map((j) => (
              <JourneyRow key={j.id} journey={j} href={href(j)} variant="completed" {...creators.get(j.id)} />
            ))}
          </ul>
        </section>
      )}

      {drafts.length > 0 && (
        <section aria-labelledby="drafts-heading">
          <h2 id="drafts-heading" className="text-sm font-medium text-os-grey">
            Unpublished drafts
          </h2>
          <ul className="mt-1 divide-y divide-os-container">
            {drafts.map(({ journey, creator }) => (
              <JourneyRow key={journey.id} journey={journey} href={editPath(domain.slug, journey.id)} variant="draft" creator={creator} />
            ))}
          </ul>
        </section>
      )}

      {canCreate && (
        <Form method="post" className="border-t border-os-container pt-6">
          <input type="hidden" name="intent" value="create" />
          <button
            type="submit"
            disabled={creating}
            className="flex w-full items-center gap-4 rounded-os-card border border-dashed border-os-container px-5 py-4 text-left transition-colors hover:border-os-container-hi hover:bg-os-hover disabled:opacity-60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-os-container text-foreground">
              <Plus className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-medium text-foreground">New {domain.name} journey</span>
              <span className="block text-sm text-os-grey">Starts as a private draft you own. Publish it when it's ready.</span>
            </span>
          </button>
        </Form>
      )}
    </div>
  );
}
