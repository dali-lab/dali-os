import { Link } from "react-router";
import { ArrowRight, CheckCircle2, CircleDashed } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import {
  describeJourney,
  getJourneyProgress,
  journeyTitle,
  nextAvailableModule,
  startModule,
} from "~/journeys/lib/journey";
import type { Journey } from "~/journeys/lib/types";

type JourneyMeta = { creator?: string | null };

/** The journey's size and length, led by who made it. */
function journeyFacts(journey: Journey, creator?: string | null) {
  return creator ? `Created by ${creator} · ${describeJourney(journey)}` : describeJourney(journey);
}

export function ProgressBar({ done, total, label, className }: { done: number; total: number; label: string; className?: string }) {
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-os-container", className)}
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-os-accent transition-[width] duration-300 ease-out"
        style={{ width: `${total ? (done / total) * 100 : 0}%` }}
      />
    </div>
  );
}

const PREVIEW_COUNT = 5;

/** The recommended journey, shown large while the learner hasn't started it. */
export function JourneyFeatureCard({ journey, href, creator }: { journey: Journey; href: string } & JourneyMeta) {
  const preview = journey.modules.slice(0, PREVIEW_COUNT);
  const first = startModule(journey);
  return (
    <article className="rounded-os-card bg-os-card p-6 lg:p-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
        <div className="flex flex-col">
          <p className="text-sm font-medium text-os-accent">Recommended for new members</p>
          <h2 className="mt-1 font-heading text-2xl font-semibold">{journeyTitle(journey)}</h2>
          {journey.description && <p className="mt-2 max-w-xl leading-7 text-os-grey">{journey.description}</p>}
          <p className="mt-3 text-sm text-os-muted">{journeyFacts(journey, creator)}</p>
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-8">
            <Link to={first ? `${href}/${first.id}` : href} className={buttonClasses("primary", "md")}>
              Start
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to={href} className={buttonClasses("secondary", "md")} aria-label={`Open the ${journeyTitle(journey)} map`}>
              Open map
            </Link>
          </div>
        </div>
        <div className="lg:border-l lg:border-os-container lg:pl-8">
          <p className="text-xs font-medium text-os-muted">What you'll cover</p>
          <ol className="mt-3 space-y-3">
            {preview.map((m, i) => (
              <li key={m.id} className="flex items-start gap-3 text-sm">
                <span className="w-4 shrink-0 tabular-nums text-os-muted">{i + 1}</span>
                <span className="text-foreground/85">{m.title}</span>
              </li>
            ))}
          </ol>
          {journey.modules.length > PREVIEW_COUNT && (
            <p className="mt-3 pl-7 text-xs text-os-muted">+{journey.modules.length - PREVIEW_COUNT} more</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function JourneyInProgressCard({
  journey,
  href,
  completed,
  creator,
}: {
  journey: Journey;
  href: string;
  completed: ReadonlySet<string>;
} & JourneyMeta) {
  const { done, total } = getJourneyProgress(journey, completed);
  const next = nextAvailableModule(journey, completed);
  return (
    <article className="flex flex-col rounded-os-card bg-os-card p-6">
      <p className="flex items-center gap-2 text-sm font-medium text-os-amber">
        <span className="h-2 w-2 rounded-full bg-os-amber" aria-hidden />
        In progress
      </p>
      <h3 className="mt-2 font-heading text-xl font-semibold">
        <Link to={href} className="transition-colors hover:text-os-accent">
          {journeyTitle(journey)}
        </Link>
      </h3>
      {journey.description && <p className="mt-1 line-clamp-2 text-sm leading-6 text-os-grey">{journey.description}</p>}
      {creator && <p className="mt-2 text-xs text-os-muted">Created by {creator}</p>}
      <div className="mt-auto pt-6">
        <ProgressBar done={done} total={total} label={`${journeyTitle(journey)} progress`} />
        <p className="mt-2 text-xs text-os-grey">
          <span className="tabular-nums text-foreground">{done}</span> of {total} modules complete
        </p>
        <p className="mt-5 min-w-0 text-sm">
          <span className="block text-xs text-os-muted">Up next</span>
          <span className="block truncate text-foreground/85">{next?.title ?? "Pick any open module"}</span>
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Link to={next ? `${href}/${next.id}` : href} className={buttonClasses("primary", "md")}>
            Continue
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link to={href} className={buttonClasses("secondary", "md")} aria-label={`Open the ${journeyTitle(journey)} map`}>
            Open map
          </Link>
        </div>
      </div>
    </article>
  );
}

export function JourneyRow({
  journey,
  href,
  variant,
  creator,
}: JourneyMeta & {
  journey: Journey;
  /** The map, or the editor for a draft (a draft has no learner page yet). */
  href: string;
  variant: "new" | "completed" | "draft";
}) {
  return (
    <li className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:gap-8">
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold">
          <Link to={href} className="transition-colors hover:text-os-accent">
            {journeyTitle(journey)}
          </Link>
        </h3>
        {journey.description && <p className="mt-1 text-sm leading-6 text-os-grey">{journey.description}</p>}
        <p className="mt-2 text-xs text-os-muted">{journeyFacts(journey, creator)}</p>
      </div>
      <div className="flex items-center gap-3 md:shrink-0">
        <p className="flex items-center gap-1.5 whitespace-nowrap text-sm md:w-44">
          {variant === "new" && (
            <>
              <CircleDashed className="h-4 w-4 text-os-muted" aria-hidden />
              <span className="text-os-muted">Not started</span>
            </>
          )}
          {variant === "completed" && (
            <>
              <CheckCircle2 className="h-4 w-4 text-os-green" aria-hidden />
              <span className="text-os-green">Completed</span>
            </>
          )}
          {variant === "draft" && (
            <>
              <span className="h-2 w-2 rounded-full bg-os-amber" aria-hidden />
              <span className="text-os-grey">Hidden from learners</span>
            </>
          )}
        </p>
        <Link
          to={href}
          className={buttonClasses(variant === "completed" ? "ghost" : "secondary", "md", "flex-1 md:w-40 md:flex-none")}
        >
          {variant === "new" ? "Open" : variant === "completed" ? "Review" : "Continue editing"}
        </Link>
      </div>
    </li>
  );
}
