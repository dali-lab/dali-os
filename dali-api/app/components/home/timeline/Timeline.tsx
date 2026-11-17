import { useEffect, type CSSProperties } from "react";
import { Link, useFetcher } from "react-router";
import { Button } from "~/components/ui/Button";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { areaInk, areaTint } from "~/lib/nav-areas";
import { eventDateBlock } from "~/members/lib/community-view";
import {
  eventMeta,
  projectsLine,
  weekStates,
  type TimelineEvent,
  type TimelineTerm,
  type WeekState,
} from "./term-timeline";

const BEVEL = "shadow-[inset_-3px_-3px_0_rgb(0_0_0/0.12)]";
const SECTION_LABEL = "text-xs font-bold uppercase tracking-[0.08em] text-os-grey";

const WEEK_CLASS: Record<WeekState, string> = {
  past: cn("bg-[var(--area-tint)]", BEVEL),
  current: cn("bg-[var(--area-ink)]", BEVEL),
  future: "bg-os-well",
  last: cn("bg-accent-pink", BEVEL),
};

export default function Timeline({
  events,
  term,
  tz,
}: {
  events: TimelineEvent[];
  term: TimelineTerm | null;
  tz: string;
}) {
  const tones = { "--area-tint": areaTint("community"), "--area-ink": areaInk("community") } as CSSProperties;
  return (
    <div
      style={tones}
      className="mt-6 grid grid-cols-1 gap-x-12 gap-y-8 px-3 lg:grid-cols-[minmax(0,1fr)_300px]"
      data-testid="home-timeline"
    >
      <ComingUp events={events} tz={tz} />
      {term && <TermProgress term={term} />}
    </div>
  );
}

function ComingUp({ events, tz }: { events: TimelineEvent[]; tz: string }) {
  return (
    <section aria-label="Coming up" className="flex min-w-0 flex-col">
      <div className="flex items-baseline justify-between pb-2">
        <h2 className={SECTION_LABEL}>Coming up</h2>
        <Link to="/community" className="text-[13px] font-semibold text-[var(--area-ink)] hover:underline">
          All events
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="border-t border-os-well py-3 text-sm text-os-grey">
          Nothing is coming up yet.{" "}
          <Link to="/community" className="font-semibold text-[var(--area-ink)] hover:underline">
            Host an event in Connect
          </Link>
        </p>
      ) : (
        <ul>
          {events.map((e) => (
            <EventRow key={e.id} event={e} tz={tz} />
          ))}
        </ul>
      )}
    </section>
  );
}

function EventRow({ event, tz }: { event: TimelineEvent; tz: string }) {
  const { month, day } = eventDateBlock(event.startsAt, tz);
  return (
    <li className="flex items-center gap-4 border-t border-os-well py-2.5">
      <span
        className={cn(
          "flex size-11 shrink-0 flex-col items-center justify-center rounded text-navy-deep",
          BEVEL,
          event.source === "dali" ? "bg-accent-pink" : "bg-accent-yellow",
        )}
      >
        <span className="text-[10px] font-extrabold leading-3 tracking-[0.08em]">{month}</span>
        <span className="text-lg font-extrabold leading-5">{day}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-bold leading-[18px] text-os-fg">{event.title}</span>
        <span className="text-[13px] leading-4 text-os-grey">{eventMeta(event, tz)}</span>
      </span>
      <span className="flex min-w-[84px] shrink-0 justify-end">
        <EventAction event={event} />
      </span>
    </li>
  );
}

function EventAction({ event }: { event: TimelineEvent }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const toast = useToast();
  useEffect(() => {
    if (fetcher.data?.ok === false) toast.error(fetcher.data.error ?? "Couldn't save your RSVP.");
  }, [fetcher.data, toast]);

  if (event.href) {
    return (
      <Link to={event.href} className="text-[13px] font-bold text-[var(--area-ink)] hover:underline">
        View
      </Link>
    );
  }
  const pending = fetcher.formData?.get("going");
  const going = pending != null ? pending === "true" : event.viewerGoing;
  if (going) {
    return (
      <span className="rounded-full bg-[var(--os-role-teal-fill)] px-2.5 py-1 text-xs font-bold text-[var(--os-role-teal-ink)]">
        Going
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={fetcher.state !== "idle"}
      onClick={() =>
        fetcher.submit({ intent: "rsvp", eventId: event.id, going: "true" }, { method: "post", action: "/community" })
      }
    >
      RSVP
    </Button>
  );
}

function TermProgress({ term }: { term: TimelineTerm }) {
  const states = weekStates(term.index);
  const line = projectsLine(term.projects);
  return (
    <section aria-label={`${term.term} at DALI`} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between pb-2">
        <h2 className={SECTION_LABEL}>{term.term} at DALI</h2>
        <span className="text-[13px] text-os-grey">
          Week {term.index} of {states.length}
        </span>
      </div>
      <ol className="flex h-7 gap-1" aria-label="Term weeks">
        {states.map((s, i) => (
          <li
            key={i}
            data-week={i + 1}
            data-state={s}
            aria-current={s === "current" ? "step" : undefined}
            className={cn("flex-1 rounded-[3px]", WEEK_CLASS[s])}
          />
        ))}
      </ol>
      <div className="text-xs text-os-muted">{term.startLabel}</div>
      {line && <p className="pt-2 text-sm leading-5 text-os-grey">{line}</p>}
    </section>
  );
}
