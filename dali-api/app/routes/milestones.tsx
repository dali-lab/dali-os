import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/cn";
import { DOMAINS, TERM_LABEL, WEEKS, type Week } from "~/lib/term-timeline";
import type { Route } from "./+types/milestones";

export const meta: Route.MetaFunction = () => [
  { title: "Milestones · DALI OS" },
];

type Mode = "timeline" | "overview";
/** Domain key, or the sentinel for "show every lane at full strength". */
type Filter = string;

const ALL: Filter = "all";

/** A week the whole lab shows up for reads coral everywhere it appears. */
function labWideOf(w: Week) {
  return w.milestones.filter((m) => m.labWide);
}

export default function Milestones() {
  const [mode, setMode] = useState<Mode>("timeline");
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<Filter>(ALL);
  const scroller = useRef<HTMLDivElement>(null);

  // Panels sit side by side in one strip, so the strip would otherwise stand as
  // tall as the longest week and leave dead space under every shorter one.
  // Measure whichever week is showing and give the strip that height.
  const [stripHeight, setStripHeight] = useState<number>();
  useEffect(() => {
    const panel = scroller.current?.children[active] as HTMLElement | undefined;
    if (!panel) return;
    const measure = () => setStripHeight(panel.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [active, mode]);

  // The week panels are a horizontal scroll-snap strip, so "go to week n"
  // is a scroll, not a re-render: the rail, the arrows and the overview cells
  // all drive the same one.
  const goTo = useCallback((i: number) => {
    setActive(i);
    setMode("timeline");
    // In overview mode the strip is unmounted; wait a frame for it to exist.
    requestAnimationFrame(() => {
      const el = scroller.current;
      const section = el?.children[i] as HTMLElement | undefined;
      if (!el || !section) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({
        left: el.scrollLeft + section.getBoundingClientRect().left - el.getBoundingClientRect().left,
        behavior: reduced ? "auto" : "smooth",
      });
    });
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    let best = 0;
    Array.from(el.children).forEach((child, i) => {
      if (child.getBoundingClientRect().left - left <= 24) best = i;
    });
    if (best !== active) setActive(best);
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-dark-blue px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white">
            Lab Term Timeline
          </span>
          <h1 className="font-heading text-2xl font-bold leading-none text-dark-blue dark:text-foreground">
            {TERM_LABEL}
          </h1>
          <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-[3px]">
            <ModeButton on={mode === "timeline"} onClick={() => setMode("timeline")}>
              Week by week
            </ModeButton>
            <ModeButton on={mode === "overview"} onClick={() => setMode("overview")}>
              All ten weeks
            </ModeButton>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-[0.08em] text-muted-foreground">
            Domains
          </span>
          {[{ key: ALL, name: "All domains", color: "#1E5779" }, ...DOMAINS].map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setFilter(d.key)}
              aria-pressed={filter === d.key}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
                filter === d.key
                  ? "border-dark-blue/25 bg-dark-blue/5 text-dark-blue dark:border-white/25 dark:bg-white/10 dark:text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="block h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
              {d.name}
            </button>
          ))}
        </div>

        <WeekRail active={active} onPick={goTo} />
      </header>

      {mode === "timeline" ? (
        <div className="relative">
          <RailArrow
            side="left"
            disabled={active === 0}
            onClick={() => goTo(Math.max(0, active - 1))}
          />
          <RailArrow
            side="right"
            disabled={active === WEEKS.length - 1}
            onClick={() => goTo(Math.min(WEEKS.length - 1, active + 1))}
          />
          <div
            ref={scroller}
            onScroll={onScroll}
            style={{ height: stripHeight }}
            className="flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden rounded-2xl border border-border bg-brand-off transition-[height] duration-300 dark:bg-background"
          >
            {WEEKS.map((w, i) => (
              <WeekPanel key={w.title} week={w} index={i} active={i === active} filter={filter} />
            ))}
          </div>
        </div>
      ) : (
        <Overview active={active} filter={filter} onPick={goTo} />
      )}
    </div>
  );
}

function ModeButton({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
        on
          ? "bg-dark-blue text-white"
          : "text-dark-blue hover:text-accent-teal dark:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Week rail — ten dots on one line. Dot size encodes what happens that */
/* week: a plain circle is heads-down work, a rotated square is a       */
/* milestone, a large coral square is an event the whole lab attends.   */
/* ------------------------------------------------------------------ */

function WeekRail({ active, onPick }: { active: number; onPick: (i: number) => void }) {
  return (
    <div className="relative grid grid-cols-10">
      <div className="absolute left-[5%] right-[5%] top-[10px] h-[3px] rounded-full bg-brand-gray dark:bg-border" />
      {WEEKS.map((w, i) => {
        const labWide = labWideOf(w);
        const hasMilestone = w.milestones.length > 0;
        const size = labWide.length ? 22 : hasMilestone ? 16 : 12;
        return (
          <button
            key={w.title}
            type="button"
            onClick={() => onPick(i)}
            title={w.milestones.length ? w.milestones.map((m) => m.name).join(" · ") : w.title}
            aria-label={`Week ${i} — ${w.title}`}
            className="relative flex h-14 flex-col items-center justify-start gap-1"
          >
            <span className="flex h-[26px] w-[26px] items-center justify-center">
              <span
                className="block transition-all duration-200"
                style={{
                  width: size,
                  height: size,
                  borderRadius: hasMilestone ? 3 : 9999,
                  transform: hasMilestone ? "rotate(45deg)" : undefined,
                  background: labWide.length ? "#FF8B81" : hasMilestone ? "#FFE7A5" : "transparent",
                  border: `3px solid ${
                    labWide.length ? "#FF8B81" : i === active ? "#FF8B81" : "#C6CACC"
                  }`,
                  boxShadow: i === active ? "0 0 0 4px rgba(255,139,129,0.28)" : undefined,
                }}
              />
            </span>
            <span
              className={cn(
                "font-heading text-xs font-bold leading-none",
                i === active
                  ? "text-accent-coral"
                  : labWide.length
                    ? "text-dark-blue dark:text-foreground"
                    : "text-muted-foreground",
              )}
            >
              W{i}
            </span>
            <span className="line-clamp-1 px-0.5 text-[9.5px] font-bold uppercase leading-none tracking-[0.05em] text-accent-coral">
              {labWide[0]?.name ?? ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function RailArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous week" : "Next week"}
      className={cn(
        // Below sm the panel is barely wider than the arrows themselves, so they
        // would sit on top of the content; the strip still swipes there.
        "absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-dark-blue text-white shadow-brand-1 transition-colors hover:bg-accent-coral disabled:opacity-35 disabled:hover:bg-dark-blue sm:flex",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* One week: the framing at the top, the milestones every team owes,    */
/* then what each domain is doing while that happens.                   */
/* ------------------------------------------------------------------ */

function WeekPanel({
  week,
  index,
  active,
  filter,
}: {
  week: Week;
  index: number;
  active: boolean;
  filter: Filter;
}) {
  return (
    <section
      aria-label={`Week ${index} — ${week.title}`}
      className={cn(
        "w-full flex-[0_0_100%] self-start snap-start border-r border-border px-6 py-8 last:border-r-0 sm:px-14",
        index % 2 === 0 ? "bg-card" : "bg-brand-off dark:bg-background",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="flex flex-wrap items-start gap-6">
          <div
            className={cn(
              "font-heading text-[84px] font-bold leading-[0.76] tracking-[-0.05em]",
              active ? "text-dark-blue dark:text-foreground" : "text-brand-gray dark:text-border",
            )}
          >
            {String(index).padStart(2, "0")}
          </div>
          <div className="min-w-[260px] flex-1">
            <div className="mb-1.5 font-mono text-xs text-accent-teal">
              Week {index} · {week.dates}
            </div>
            <h2 className="mb-2 font-heading text-4xl font-bold leading-none tracking-[-0.035em] text-dark-blue dark:text-foreground sm:text-5xl">
              {week.title}
            </h2>
            <p className="max-w-[60ch] text-pretty leading-relaxed text-muted-foreground">
              {week.blurb}
            </p>
          </div>
        </div>

        {week.milestones.length > 0 && (
          <div className="flex flex-col gap-3">
            {week.milestones.map((m) =>
              m.labWide ? (
                <div key={m.name} className="rounded-2xl bg-accent-coral p-6 sm:p-7">
                  <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-white">
                    Lab-wide event
                  </span>
                  <h3 className="mt-3 font-heading text-4xl font-bold leading-none tracking-[-0.02em] text-white">
                    {m.name}
                  </h3>
                  <p className="mt-2 max-w-[70ch] leading-relaxed text-white/90">{m.detail}</p>
                </div>
              ) : (
                <div key={m.name} className="rounded-2xl border border-border bg-card p-5">
                  <span className="inline-block rounded-full bg-accent-coral/10 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-accent-coral">
                    Shared milestone
                  </span>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <h3 className="font-heading text-2xl font-bold leading-none tracking-[-0.02em] text-accent-coral">
                      {m.name}
                    </h3>
                    <p className="min-w-[260px] flex-1 text-sm leading-relaxed text-muted-foreground">
                      {m.detail}
                    </p>
                  </div>
                </div>
              ),
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {DOMAINS.map((d, j) => {
            const lane = week.lanes[j];
            return (
              <article
                key={d.key}
                className={cn(
                  "flex flex-col gap-3.5 rounded-xl border border-border bg-card p-5 transition-opacity",
                  filter !== ALL && filter !== d.key && "opacity-30",
                )}
                style={{ borderTop: `5px solid ${d.color}` }}
              >
                <div className="flex items-center gap-2">
                  <span className="block h-2 w-2 rounded-[2px]" style={{ background: d.color }} />
                  <span className="text-[12.5px] font-semibold text-muted-foreground">
                    {d.name}
                  </span>
                </div>
                <h4 className="font-heading text-xl font-semibold leading-tight text-dark-blue dark:text-foreground">
                  {lane.role}
                </h4>
                <ul className="flex flex-col">
                  {lane.deliverables.map((text) => (
                    <li
                      key={text}
                      className="flex gap-2 border-t border-border py-2 text-sm leading-snug text-foreground/80"
                    >
                      <span aria-hidden className="text-brand-gray">
                        →
                      </span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-auto flex gap-2 border-t border-border pt-3 text-[13px] leading-snug text-muted-foreground">
                  <span aria-hidden className="font-bold text-accent-coral">
                    !
                  </span>
                  <span>{lane.challenge}</span>
                </p>
              </article>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            Resources
          </span>
          {week.resources.map((r) => (
            <span
              key={r}
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-semibold text-accent-teal"
            >
              {r}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* All ten weeks at once — the term as a grid, one column per week.     */
/* Every cell opens that week in the timeline view.                     */
/* ------------------------------------------------------------------ */

const GRID = "grid grid-cols-[132px_repeat(10,minmax(96px,1fr))] gap-2";

function Overview({
  active,
  filter,
  onPick,
}: {
  active: number;
  filter: Filter;
  onPick: (i: number) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-brand-off p-5 dark:bg-background">
      <div className="min-w-[1000px]">
        <div className={cn(GRID, "mb-2.5 items-end")}>
          <div />
          {WEEKS.map((w, i) => (
            <button
              key={w.title}
              type="button"
              onClick={() => onPick(i)}
              className="pb-1.5 text-left"
            >
              <div
                className={cn(
                  "font-heading text-xl font-bold leading-none",
                  i === active ? "text-dark-blue dark:text-foreground" : "text-muted-foreground",
                )}
              >
                W{i}
              </div>
              <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{w.title}</div>
            </button>
          ))}
        </div>

        <MilestoneRow label="Lab-wide" labWide onPick={onPick} />
        <MilestoneRow label="Team milestone" labWide={false} onPick={onPick} />

        {DOMAINS.map((d, j) => (
          <div
            key={d.key}
            className={cn(
              GRID,
              "mb-2 transition-opacity",
              filter !== ALL && filter !== d.key && "opacity-30",
            )}
          >
            <div className="flex items-center gap-2 pr-2">
              <span
                className="block h-3 w-3 flex-none rounded-[3px]"
                style={{ background: d.color }}
              />
              <span className="text-[13px] font-semibold leading-tight text-dark-blue dark:text-foreground">
                {d.name}
              </span>
            </div>
            {WEEKS.map((w, i) => (
              <button
                key={w.title}
                type="button"
                onClick={() => onPick(i)}
                style={{ borderLeft: `4px solid ${d.color}` }}
                className="min-h-[74px] rounded-xl border border-border bg-card p-2.5 text-left text-xs leading-snug transition-transform hover:-translate-y-0.5"
              >
                <span className="block font-semibold text-dark-blue dark:text-foreground">
                  {w.lanes[j].role}
                </span>
                <span className="mt-0.5 block text-muted-foreground">
                  {w.lanes[j].deliverables[0] ?? ""}
                </span>
              </button>
            ))}
          </div>
        ))}

        <div className="mt-5 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
          <Legend swatch={<span className="h-3.5 w-3.5 rounded-[2px] bg-accent-coral" />}>
            Lab-wide event — the whole lab in one room (Prod Tales, Bug Hunt, Technigala)
          </Legend>
          <Legend swatch={<span className="h-3.5 w-3.5 rounded bg-accent-coral/20" />}>
            Team milestone — each team hits it on its own
          </Legend>
          <Legend
            swatch={
              <span className="h-3.5 w-3.5 rounded border border-border border-l-[3px] border-l-accent-teal bg-card" />
            }
          >
            Work that domain owns on its own
          </Legend>
          <span>Click any cell to open that week.</span>
        </div>
      </div>
    </div>
  );
}

function MilestoneRow({
  label,
  labWide,
  onPick,
}: {
  label: string;
  labWide: boolean;
  onPick: (i: number) => void;
}) {
  return (
    <div className={cn(GRID, labWide ? "mb-2" : "mb-4")}>
      <div
        className={cn(
          "flex items-center text-[11.5px] font-bold uppercase leading-tight tracking-[0.06em]",
          labWide ? "text-accent-coral" : "text-accent-coral/80",
        )}
      >
        {label}
      </div>
      {WEEKS.map((w, i) => {
        const names = w.milestones.filter((m) => m.labWide === labWide).map((m) => m.name);
        return (
          <button
            key={w.title}
            type="button"
            onClick={() => onPick(i)}
            className={cn(
              "rounded-xl p-2.5 text-left font-heading font-semibold leading-tight",
              labWide ? "min-h-[66px] text-[17px]" : "min-h-[48px] text-[13px]",
              names.length === 0
                ? "bg-muted text-muted-foreground/60"
                : labWide
                  ? "bg-accent-coral text-white"
                  : "bg-accent-coral/15 text-accent-coral",
            )}
          >
            {names.join(" · ") || "—"}
          </button>
        );
      })}
    </div>
  );
}

function Legend({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      {swatch}
      {children}
    </span>
  );
}
