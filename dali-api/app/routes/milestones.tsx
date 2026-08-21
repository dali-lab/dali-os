import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useSubmit } from "react-router";
import { ChevronLeft, ChevronRight, ImagePlus, Loader2, Plus, Settings, X } from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isAdmin, isCore, currentTerm, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { cn } from "~/lib/cn";
import { uploadFileToS3 } from "~/lib/upload-client";
import { DOMAIN_COLORS, SWATCHES, type FieldFormat, type FormatMap } from "~/lib/term-timeline";
import {
  addDomain,
  loadTimeline,
  removeDomain,
  resetWeek,
  type TimelineDomainView,
  type TimelineWeekView,
} from "~/lib/term-timeline.server";
import type { Route } from "./+types/milestones";

export const meta: Route.MetaFunction = () => [{ title: "Milestones · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

  const timeline = await loadTimeline();
  // Core and Admin own lab-wide content; everyone else reads it.
  const canEdit =
    timeline.termId !== null &&
    ((await isCore(auth.user.sub, request)) || (await isAdmin(auth.user.sub)));

  // The versioned, per-project milestone sets live at /core/milestones behind
  // the milestones-v2 flag. Surface a link there for Core when it's on.
  const roles = await getUserRoles(auth.user.sub, request);
  const canManageSets =
    (await isCore(auth.user.sub, request)) &&
    (await isFeatureEnabled("milestones-v2", auth.user.sub, roles, request));

  return { ...timeline, canEdit, canManageSets };
}

const WEEK_TEXT_FIELDS = ["title", "dates", "blurb"] as const;
const MILESTONE_TEXT_FIELDS = ["name", "detail"] as const;
const LANE_TEXT_FIELDS = ["role", "challenge"] as const;

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!((await isCore(auth.user.sub, request)) || (await isAdmin(auth.user.sub)))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const str = (name: string) => String(form.get(name) ?? "");
  const int = (name: string) => Number.parseInt(str(name), 10);

  switch (intent) {
    case "week.text": {
      const field = str("field");
      if (!WEEK_TEXT_FIELDS.includes(field as (typeof WEEK_TEXT_FIELDS)[number])) break;
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { [field]: str("value") },
      });
      break;
    }
    case "week.image": {
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { imageKey: str("imageKey") || null, imageAlt: str("imageAlt") || null },
      });
      break;
    }
    case "week.imageAlt": {
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { imageAlt: str("value") || null },
      });
      break;
    }
    case "week.format": {
      // The whole map is rewritten each time: it is small, and merging on the
      // client keeps the "clear this field" case from needing its own intent.
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { format: JSON.parse(str("format") || "{}") },
      });
      break;
    }
    case "week.reset": {
      await resetWeek(str("weekId"));
      break;
    }
    case "resource.add": {
      const week = await prisma.timelineWeek.findUnique({
        where: { id: str("weekId") },
        select: { resources: true },
      });
      if (!week) break;
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { resources: [...week.resources, "New resource"] },
      });
      break;
    }
    case "resource.set":
    case "resource.remove": {
      const week = await prisma.timelineWeek.findUnique({
        where: { id: str("weekId") },
        select: { resources: true },
      });
      if (!week) break;
      const index = int("index");
      if (!Number.isInteger(index) || index < 0 || index >= week.resources.length) break;
      const next = [...week.resources];
      if (intent === "resource.remove") next.splice(index, 1);
      else next[index] = str("value");
      await prisma.timelineWeek.update({
        where: { id: str("weekId") },
        data: { resources: next },
      });
      break;
    }
    case "milestone.add": {
      const count = await prisma.timelineMilestone.count({ where: { weekId: str("weekId") } });
      await prisma.timelineMilestone.create({
        data: {
          weekId: str("weekId"),
          name: "New milestone",
          detail: "What this milestone requires.",
          labWide: false,
          position: count,
        },
      });
      break;
    }
    case "milestone.text": {
      const field = str("field");
      if (!MILESTONE_TEXT_FIELDS.includes(field as (typeof MILESTONE_TEXT_FIELDS)[number])) break;
      await prisma.timelineMilestone.update({
        where: { id: str("id") },
        data: { [field]: str("value") },
      });
      break;
    }
    case "milestone.tier": {
      const milestone = await prisma.timelineMilestone.findUnique({
        where: { id: str("id") },
        select: { labWide: true },
      });
      if (!milestone) break;
      await prisma.timelineMilestone.update({
        where: { id: str("id") },
        data: { labWide: !milestone.labWide },
      });
      break;
    }
    case "milestone.remove": {
      await prisma.timelineMilestone.delete({ where: { id: str("id") } });
      break;
    }
    case "domain.add": {
      const term = await currentTerm();
      if (!term) break;
      await addDomain(term.id);
      break;
    }
    case "domain.name": {
      await prisma.timelineDomain.update({
        where: { id: str("id") },
        data: { name: str("value") },
      });
      break;
    }
    case "domain.color": {
      const color = str("value");
      if (!DOMAIN_COLORS.includes(color)) break;
      await prisma.timelineDomain.update({ where: { id: str("id") }, data: { color } });
      break;
    }
    case "domain.remove": {
      await removeDomain(str("id"));
      break;
    }
    case "lane.text": {
      const field = str("field");
      if (!LANE_TEXT_FIELDS.includes(field as (typeof LANE_TEXT_FIELDS)[number])) break;
      await prisma.timelineLane.update({
        where: { id: str("id") },
        data: { [field]: str("value") },
      });
      break;
    }
    case "deliverable.add":
    case "deliverable.set":
    case "deliverable.remove": {
      const lane = await prisma.timelineLane.findUnique({
        where: { id: str("id") },
        select: { deliverables: true },
      });
      if (!lane) break;
      const next = [...lane.deliverables];
      if (intent === "deliverable.add") {
        next.push("New deliverable");
      } else {
        const index = int("index");
        if (!Number.isInteger(index) || index < 0 || index >= next.length) break;
        if (intent === "deliverable.remove") next.splice(index, 1);
        else next[index] = str("value");
      }
      await prisma.timelineLane.update({ where: { id: str("id") }, data: { deliverables: next } });
      break;
    }
  }

  return { ok: true };
}

type Mode = "timeline" | "overview";
/** Domain key, or the sentinel for "show every lane at full strength". */
type Filter = string;
const ALL: Filter = "all";

/** Which field the formatting toolbar is pointed at. */
type Focus = { weekId: string; path: string; label: string; baseSize: number };

/** Save one edit. Fetcher-style (no navigation); the loader revalidates after. */
type Save = (fields: Record<string, string>) => void;

function labWideOf(week: TimelineWeekView) {
  return week.milestones.filter((m) => m.labWide);
}

export default function Milestones() {
  const { weeks, domains, termLabel, canEdit, canManageSets } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const [mode, setMode] = useState<Mode>("timeline");
  const [active, setActive] = useState(0);
  const [filter, setFilter] = useState<Filter>(ALL);
  const [editing, setEditing] = useState(false);
  const [focus, setFocus] = useState<Focus | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const save = useCallback<Save>(
    (fields) => {
      submit(fields, { method: "post", navigate: false });
    },
    [submit],
  );

  // A filter pointed at a domain that has just been removed would dim every
  // lane; drop back to showing them all.
  useEffect(() => {
    if (filter !== ALL && !domains.some((d) => d.key === filter)) setFilter(ALL);
  }, [domains, filter]);

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
  }, [active, mode, editing]);

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
            {termLabel}
          </h1>
          <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-[3px]">
            <ModeButton on={mode === "timeline"} onClick={() => setMode("timeline")}>
              Week by week
            </ModeButton>
            <ModeButton on={mode === "overview"} onClick={() => setMode("overview")}>
              All ten weeks
            </ModeButton>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => {
                setEditing((e) => !e);
                setFocus(null);
                setFilter(ALL);
              }}
              className={cn(
                "rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors",
                editing
                  ? "border-accent-teal bg-accent-teal text-white"
                  : "border-border text-dark-blue hover:border-accent-teal dark:text-foreground",
              )}
            >
              {editing ? "Done editing" : "Edit content"}
            </button>
          )}
          {canManageSets && (
            <Link
              to="/core/milestones"
              prefetch="intent"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[13px] font-semibold text-dark-blue transition-colors hover:border-accent-coral dark:text-foreground"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage sets
            </Link>
          )}
        </div>

        {/* One domain row at a time: filtering while editing only dims the
            lanes you are there to edit, so edit mode takes the row over. */}
        {editing ? (
          <DomainEditor domains={domains} save={save} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Domains
            </span>
            {[{ key: ALL, name: "All domains", color: "#1E5779" }, ...domains].map((d) => (
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
        )}

        <WeekRail weeks={weeks} active={active} onPick={goTo} />
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
            disabled={active === weeks.length - 1}
            onClick={() => goTo(Math.min(weeks.length - 1, active + 1))}
          />
          <div
            ref={scroller}
            onScroll={onScroll}
            style={{ height: stripHeight }}
            className="flex snap-x snap-mandatory items-start overflow-x-auto overflow-y-hidden rounded-2xl border border-border bg-brand-off transition-[height] duration-300 dark:bg-background"
          >
            {weeks.map((w) => (
              <WeekPanel
                key={w.index}
                week={w}
                domains={domains}
                active={w.index === active}
                filter={filter}
                editing={editing}
                save={save}
                onFocusField={setFocus}
              />
            ))}
          </div>
        </div>
      ) : (
        <Overview
          weeks={weeks}
          domains={domains}
          active={active}
          filter={filter}
          onPick={goTo}
        />
      )}

      {editing && (
        <FormatToolbar
          focus={focus}
          weeks={weeks}
          activeWeek={weeks[active]}
          save={save}
        />
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
/* Editable text — reads as plain text until edit mode is on, then      */
/* becomes an inline field that saves on blur. Typography overrides     */
/* from the toolbar ride along as inline styles.                        */
/* ------------------------------------------------------------------ */

function styleFor(format: FieldFormat | undefined): React.CSSProperties | undefined {
  if (!format) return undefined;
  return {
    fontSize: format.size ? `${format.size}px` : undefined,
    fontWeight: format.bold ? 700 : undefined,
    color: format.color,
  };
}

function Editable({
  as: Tag = "span",
  value,
  editing,
  format,
  className,
  onCommit,
  onFocusField,
}: {
  as?: "span" | "div" | "p";
  value: string;
  editing: boolean;
  format?: FieldFormat;
  className?: string;
  onCommit: (value: string) => void;
  onFocusField?: (el: HTMLElement) => void;
}) {
  return (
    <Tag
      contentEditable={editing}
      suppressContentEditableWarning
      style={styleFor(format)}
      className={cn(
        className,
        editing &&
          "rounded outline-none ring-1 ring-accent-teal/30 transition-shadow hover:ring-accent-teal/60 focus:bg-accent-teal/5 focus:ring-2 focus:ring-accent-teal",
      )}
      onFocus={(e: React.FocusEvent<HTMLElement>) => onFocusField?.(e.currentTarget)}
      onBlur={(e: React.FocusEvent<HTMLElement>) => {
        const text = e.currentTarget.innerText.replace(/\s+$/, "");
        if (text !== value) onCommit(text);
      }}
    >
      {value}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Domain editor — the term's lanes themselves, not the content in them. */
/* Renaming, recolouring or removing one here lands on every week at     */
/* once, which is why it sits in the header rather than inside a panel.  */
/* ------------------------------------------------------------------ */

function DomainEditor({
  domains,
  save,
}: {
  domains: TimelineDomainView[];
  save: Save;
}) {
  const [picking, setPicking] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-dashed border-accent-teal/50 bg-accent-teal/5 p-2.5">
      <span className="ml-1 mr-1 text-xs uppercase tracking-[0.08em] text-muted-foreground">
        Edit domains
      </span>
      {domains.map((d) => (
        <span
          key={d.id}
          className="relative flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-2.5 pr-2.5"
        >
          <button
            type="button"
            aria-label={`Colour for ${d.name}`}
            onClick={() => setPicking((p) => (p === d.id ? null : d.id))}
            className="block h-4 w-4 flex-none rounded-[3px] ring-1 ring-inset ring-black/10"
            style={{ background: d.color }}
          />
          {picking === d.id && (
            <span className="absolute left-0 top-full z-30 mt-1.5 flex gap-1.5 rounded-full border border-border bg-popover p-1.5 shadow-brand-2">
              {DOMAIN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use ${c}`}
                  onClick={() => {
                    save({ intent: "domain.color", id: d.id, value: c });
                    setPicking(null);
                  }}
                  className="h-5 w-5 rounded-[3px] border-2"
                  style={{ background: c, borderColor: d.color === c ? "#1E5779" : "transparent" }}
                />
              ))}
            </span>
          )}
          <Editable
            value={d.name}
            editing
            className="text-[13px] font-semibold text-dark-blue dark:text-foreground"
            onCommit={(value) => save({ intent: "domain.name", id: d.id, value })}
          />
          <RemoveButton
            label={`Remove ${d.name}`}
            onClick={() => {
              if (!confirm(`Remove ${d.name} from every week of this term?`)) return;
              save({ intent: "domain.remove", id: d.id });
            }}
          />
        </span>
      ))}
      <button
        type="button"
        onClick={() => save({ intent: "domain.add" })}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-accent-teal px-3.5 py-1.5 text-xs font-semibold text-accent-teal"
      >
        <Plus className="h-3 w-3" /> domain
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Week rail — ten dots on one line. Dot size encodes what happens that */
/* week: a plain circle is heads-down work, a rotated square is a       */
/* milestone, a large coral square is an event the whole lab attends.   */
/* ------------------------------------------------------------------ */

function WeekRail({
  weeks,
  active,
  onPick,
}: {
  weeks: TimelineWeekView[];
  active: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="relative grid" style={{ gridTemplateColumns: `repeat(${weeks.length}, 1fr)` }}>
      <div className="absolute left-[5%] right-[5%] top-[10px] h-[3px] rounded-full bg-brand-gray dark:bg-border" />
      {weeks.map((w, i) => {
        const labWide = labWideOf(w);
        const hasMilestone = w.milestones.length > 0;
        const size = labWide.length ? 22 : hasMilestone ? 16 : 12;
        return (
          <button
            key={w.index}
            type="button"
            onClick={() => onPick(i)}
            title={w.milestones.length ? w.milestones.map((m) => m.name).join(" · ") : w.title}
            aria-label={`Week ${w.index} — ${w.title}`}
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
              W{w.index}
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
  domains,
  active,
  filter,
  editing,
  save,
  onFocusField,
}: {
  week: TimelineWeekView;
  domains: TimelineDomainView[];
  active: boolean;
  filter: Filter;
  editing: boolean;
  save: Save;
  onFocusField: (focus: Focus) => void;
}) {
  const weekId = week.id ?? "";
  // Every editable field reports itself to the toolbar with its path and the
  // size it renders at, so A+/A− has something to count from.
  const focusReporter = (path: string, label: string) => (el: HTMLElement) =>
    onFocusField({
      weekId,
      path,
      label,
      baseSize: Math.round(Number.parseFloat(getComputedStyle(el).fontSize)) || 14,
    });

  return (
    <section
      aria-label={`Week ${week.index} — ${week.title}`}
      className={cn(
        "w-full flex-[0_0_100%] self-start snap-start border-r border-border px-6 py-8 last:border-r-0 sm:px-14",
        week.index % 2 === 0 ? "bg-card" : "bg-brand-off dark:bg-background",
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
            {String(week.index).padStart(2, "0")}
          </div>
          <div className="min-w-[260px] flex-1">
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-xs text-accent-teal">
              <span>Week {week.index} ·</span>
              <Editable
                value={week.dates}
                editing={editing}
                format={week.format["dates"]}
                onCommit={(value) =>
                  save({ intent: "week.text", weekId, field: "dates", value })
                }
                onFocusField={focusReporter("dates", "Dates")}
              />
            </div>
            <Editable
              as="div"
              value={week.title}
              editing={editing}
              format={week.format["title"]}
              className="mb-2 font-heading text-4xl font-bold leading-none tracking-[-0.035em] text-dark-blue dark:text-foreground sm:text-5xl"
              onCommit={(value) => save({ intent: "week.text", weekId, field: "title", value })}
              onFocusField={focusReporter("title", "Week title")}
            />
            <Editable
              as="p"
              value={week.blurb}
              editing={editing}
              format={week.format["blurb"]}
              className="max-w-[60ch] text-pretty leading-relaxed text-muted-foreground"
              onCommit={(value) => save({ intent: "week.text", weekId, field: "blurb", value })}
              onFocusField={focusReporter("blurb", "Week blurb")}
            />
          </div>
          {(week.imageUrl || editing) && (
            <WeekImage week={week} editing={editing} save={save} />
          )}
        </div>

        {(week.milestones.length > 0 || editing) && (
          <div className="flex flex-col gap-3">
            {week.milestones.map((m) =>
              m.labWide ? (
                <div key={m.id} className="rounded-2xl bg-accent-coral p-6 sm:p-7">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-block rounded-full bg-white/20 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-white">
                      Lab-wide event
                    </span>
                    {editing && <MilestoneControls id={m.id} labWide save={save} onDark />}
                  </div>
                  <Editable
                    as="div"
                    value={m.name}
                    editing={editing}
                    format={week.format[`milestone:${m.id}.name`]}
                    className="mt-3 font-heading text-4xl font-bold leading-none tracking-[-0.02em] text-white"
                    onCommit={(value) =>
                      save({ intent: "milestone.text", id: m.id, field: "name", value })
                    }
                    onFocusField={focusReporter(`milestone:${m.id}.name`, "Event name")}
                  />
                  <Editable
                    as="p"
                    value={m.detail}
                    editing={editing}
                    format={week.format[`milestone:${m.id}.detail`]}
                    className="mt-2 max-w-[70ch] leading-relaxed text-white/90"
                    onCommit={(value) =>
                      save({ intent: "milestone.text", id: m.id, field: "detail", value })
                    }
                    onFocusField={focusReporter(`milestone:${m.id}.detail`, "Event detail")}
                  />
                </div>
              ) : (
                <div key={m.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-block rounded-full bg-accent-coral/10 px-3 py-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-accent-coral">
                      Shared milestone
                    </span>
                    {editing && <MilestoneControls id={m.id} labWide={false} save={save} />}
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1">
                    <Editable
                      value={m.name}
                      editing={editing}
                      format={week.format[`milestone:${m.id}.name`]}
                      className="font-heading text-2xl font-bold leading-none tracking-[-0.02em] text-accent-coral"
                      onCommit={(value) =>
                        save({ intent: "milestone.text", id: m.id, field: "name", value })
                      }
                      onFocusField={focusReporter(`milestone:${m.id}.name`, "Milestone name")}
                    />
                    <Editable
                      as="p"
                      value={m.detail}
                      editing={editing}
                      format={week.format[`milestone:${m.id}.detail`]}
                      className="min-w-[260px] flex-1 text-sm leading-relaxed text-muted-foreground"
                      onCommit={(value) =>
                        save({ intent: "milestone.text", id: m.id, field: "detail", value })
                      }
                      onFocusField={focusReporter(`milestone:${m.id}.detail`, "Milestone detail")}
                    />
                  </div>
                </div>
              ),
            )}
            {editing && (
              <button
                type="button"
                onClick={() => save({ intent: "milestone.add", weekId })}
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-accent-coral/70 bg-accent-coral/5 px-4 py-2 text-[13px] font-semibold text-accent-coral"
              >
                <Plus className="h-3.5 w-3.5" /> shared milestone
              </button>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {week.lanes.map((lane) => {
            const domain = domains.find((d) => d.key === lane.domainKey);
            if (!domain) return null;
            return (
              <article
                key={lane.id}
                className={cn(
                  "flex flex-col gap-3.5 rounded-xl border border-border bg-card p-5 transition-opacity",
                  // Capped so one long deliverables list can't stretch its whole
                  // grid row — every card reads at the same height and the list
                  // scrolls inside instead. Uncapped while editing, where a
                  // deliverable you can't see is one you can't fix.
                  !editing && "max-h-96",
                  filter !== ALL && filter !== domain.key && "opacity-30",
                )}
                style={{ borderTop: `5px solid ${domain.color}` }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="block h-2 w-2 rounded-[2px]"
                    style={{ background: domain.color }}
                  />
                  <span className="text-[12.5px] font-semibold text-muted-foreground">
                    {domain.name}
                  </span>
                </div>
                <Editable
                  as="div"
                  value={lane.role}
                  editing={editing}
                  format={week.format[`lane:${lane.id}.role`]}
                  className="font-heading text-xl font-semibold leading-tight text-dark-blue dark:text-foreground"
                  onCommit={(value) =>
                    save({ intent: "lane.text", id: lane.id, field: "role", value })
                  }
                  onFocusField={focusReporter(`lane:${lane.id}.role`, `${domain.name} role`)}
                />
                <ul className="flex min-h-0 flex-col overflow-y-auto">
                  {lane.deliverables.map((text, k) => (
                    <li
                      key={k}
                      className="flex gap-2 border-t border-border py-2 text-sm leading-snug text-foreground/80"
                    >
                      <span aria-hidden className="text-brand-gray">
                        →
                      </span>
                      <Editable
                        value={text}
                        editing={editing}
                        format={week.format[`lane:${lane.id}.deliverable.${k}`]}
                        className="flex-1"
                        onCommit={(value) =>
                          save({
                            intent: "deliverable.set",
                            id: lane.id,
                            index: String(k),
                            value,
                          })
                        }
                        onFocusField={focusReporter(
                          `lane:${lane.id}.deliverable.${k}`,
                          "Deliverable",
                        )}
                      />
                      {editing && (
                        <RemoveButton
                          label="Remove deliverable"
                          onClick={() =>
                            save({ intent: "deliverable.remove", id: lane.id, index: String(k) })
                          }
                        />
                      )}
                    </li>
                  ))}
                </ul>
                {editing && (
                  <button
                    type="button"
                    onClick={() => save({ intent: "deliverable.add", id: lane.id })}
                    className="inline-flex w-fit items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground"
                  >
                    <Plus className="h-3 w-3" /> deliverable
                  </button>
                )}
                <p className="mt-auto flex gap-2 border-t border-border pt-3 text-[13px] leading-snug text-muted-foreground">
                  <span aria-hidden className="font-bold text-accent-coral">
                    !
                  </span>
                  <Editable
                    value={lane.challenge}
                    editing={editing}
                    format={week.format[`lane:${lane.id}.challenge`]}
                    className="flex-1"
                    onCommit={(value) =>
                      save({ intent: "lane.text", id: lane.id, field: "challenge", value })
                    }
                    onFocusField={focusReporter(
                      `lane:${lane.id}.challenge`,
                      `${domain.name} challenge`,
                    )}
                  />
                </p>
              </article>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
            Resources
          </span>
          {week.resources.map((r, k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] font-semibold text-accent-teal"
            >
              <Editable
                value={r}
                editing={editing}
                format={week.format[`resource.${k}`]}
                onCommit={(value) =>
                  save({ intent: "resource.set", weekId, index: String(k), value })
                }
                onFocusField={focusReporter(`resource.${k}`, "Resource")}
              />
              {editing && (
                <RemoveButton
                  label="Remove resource"
                  onClick={() => save({ intent: "resource.remove", weekId, index: String(k) })}
                />
              )}
            </span>
          ))}
          {editing && (
            <button
              type="button"
              onClick={() => save({ intent: "resource.add", weekId })}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground"
            >
              <Plus className="h-3 w-3" /> resource
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="text-brand-gray transition-colors hover:text-accent-coral"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function MilestoneControls({
  id,
  labWide,
  save,
  onDark = false,
}: {
  id: string;
  labWide: boolean;
  save: Save;
  onDark?: boolean;
}) {
  const cls = cn(
    "rounded-full border px-3 py-1 text-xs transition-colors",
    onDark
      ? "border-white/40 text-white hover:bg-white/15"
      : "border-border text-muted-foreground hover:text-foreground",
  );
  return (
    <span className="flex items-center gap-2">
      <button type="button" className={cls} onClick={() => save({ intent: "milestone.tier", id })}>
        {labWide ? "Make team-level" : "Make lab-wide"}
      </button>
      <button
        type="button"
        className={cls}
        onClick={() => save({ intent: "milestone.remove", id })}
      >
        Remove
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Week image — a photo from the week. Uploads go straight to S3 and    */
/* only the resulting key is saved, the same path project files take.   */
/* ------------------------------------------------------------------ */

function WeekImage({
  week,
  editing,
  save,
}: {
  week: TimelineWeekView;
  editing: boolean;
  save: Save;
}) {
  const weekId = week.id ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { s3Key } = await uploadFileToS3(file, "term-timeline", "image/*");
      save({ intent: "week.image", weekId, imageKey: s3Key, imageAlt: week.imageAlt ?? "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <figure className="m-0 w-[260px] min-w-[200px] flex-none">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
        {week.imageUrl ? (
          <img
            src={week.imageUrl}
            alt={week.imageAlt ?? ""}
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center text-xs text-muted-foreground">
            No photo yet
          </div>
        )}
        {editing && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-black/55 px-2 py-1.5">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {week.imageUrl ? "Replace" : "Add photo"}
            </button>
            {week.imageUrl && (
              <button
                type="button"
                onClick={() => save({ intent: "week.image", weekId, imageKey: "", imageAlt: "" })}
                className="text-xs text-white/80 hover:text-white"
              >
                Remove
              </button>
            )}
            <input
              ref={input}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                void onPick(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {editing && week.imageUrl && (
        <Editable
          as="p"
          value={week.imageAlt ?? ""}
          editing
          className="mt-1.5 text-xs text-muted-foreground"
          onCommit={(value) => save({ intent: "week.imageAlt", weekId, value })}
        />
      )}
      {editing && week.imageUrl && !week.imageAlt && (
        <p className="mt-1 text-[11px] italic text-muted-foreground">
          Describe the photo above for screen readers.
        </p>
      )}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Formatting toolbar — size, weight and colour for whichever field is  */
/* focused, stored per field on the week.                               */
/* ------------------------------------------------------------------ */

function FormatToolbar({
  focus,
  weeks,
  activeWeek,
  save,
}: {
  focus: Focus | null;
  weeks: TimelineWeekView[];
  activeWeek: TimelineWeekView | undefined;
  save: Save;
}) {
  const week = focus ? weeks.find((w) => w.id === focus.weekId) : undefined;
  const current: FieldFormat = (focus && week?.format[focus.path]) || {};

  const patch = (change: FieldFormat | null) => {
    if (!focus || !week) return;
    const next: FormatMap = { ...week.format };
    if (change === null) delete next[focus.path];
    else next[focus.path] = { ...current, ...change };
    save({ intent: "week.format", weekId: focus.weekId, format: JSON.stringify(next) });
  };

  const bump = (delta: number) =>
    patch({ size: Math.max(9, Math.min(96, (current.size ?? focus?.baseSize ?? 14) + delta)) });

  const buttonCls =
    "flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold text-dark-blue disabled:opacity-40 dark:text-foreground";

  return (
    // mousedown is swallowed so clicking a control doesn't blur the field it
    // is about to format.
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="sticky bottom-4 z-40 mx-auto flex flex-wrap items-center gap-2.5 rounded-full border border-border bg-popover/95 px-4 py-2 shadow-brand-2 backdrop-blur"
    >
      <span className="max-w-[200px] truncate text-xs text-muted-foreground">
        {focus ? `Editing: ${focus.label}` : "Click any text to edit it"}
      </span>
      <span className="h-5 w-px bg-border" />
      <button type="button" className={buttonCls} disabled={!focus} onClick={() => bump(-1)}>
        A−
      </button>
      <button type="button" className={buttonCls} disabled={!focus} onClick={() => bump(1)}>
        A+
      </button>
      <button
        type="button"
        disabled={!focus}
        onClick={() => patch({ bold: !current.bold })}
        className={cn(buttonCls, current.bold && "bg-dark-blue text-white dark:text-white")}
      >
        B
      </button>
      <span className="h-5 w-px bg-border" />
      {SWATCHES.map((s) => (
        <button
          key={s.color}
          type="button"
          disabled={!focus}
          title={s.name}
          aria-label={s.name}
          onClick={() => patch({ color: s.color })}
          className="h-5 w-5 rounded-full border-2 disabled:opacity-40"
          style={{ background: s.color, borderColor: current.color === s.color ? "#1E5779" : "transparent" }}
        />
      ))}
      <span className="h-5 w-px bg-border" />
      <button
        type="button"
        disabled={!focus}
        onClick={() => patch(null)}
        className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        Clear format
      </button>
      <button
        type="button"
        disabled={!activeWeek?.id}
        onClick={() => {
          if (!activeWeek?.id) return;
          if (!confirm(`Reset week ${activeWeek.index} to the default content?`)) return;
          save({ intent: "week.reset", weekId: activeWeek.id });
        }}
        className="text-xs font-semibold text-accent-coral hover:underline disabled:opacity-40"
      >
        Reset week
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* All ten weeks at once — the term as a grid, one column per week.     */
/* Every cell opens that week in the timeline view.                     */
/* ------------------------------------------------------------------ */

function Overview({
  weeks,
  domains,
  active,
  filter,
  onPick,
}: {
  weeks: TimelineWeekView[];
  domains: TimelineDomainView[];
  active: number;
  filter: Filter;
  onPick: (i: number) => void;
}) {
  const grid = "grid gap-2";
  const columns = { gridTemplateColumns: `132px repeat(${weeks.length}, minmax(96px, 1fr))` };

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-brand-off p-5 dark:bg-background">
      <div className="min-w-[1000px]">
        <div className={cn(grid, "mb-2.5 items-end")} style={columns}>
          <div />
          {weeks.map((w, i) => (
            <button key={w.index} type="button" onClick={() => onPick(i)} className="pb-1.5 text-left">
              <div
                className={cn(
                  "font-heading text-xl font-bold leading-none",
                  i === active ? "text-dark-blue dark:text-foreground" : "text-muted-foreground",
                )}
              >
                W{w.index}
              </div>
              <div className="mt-1 text-[11px] leading-tight text-muted-foreground">{w.title}</div>
            </button>
          ))}
        </div>

        <MilestoneRow weeks={weeks} label="Lab-wide" labWide onPick={onPick} style={columns} />
        <MilestoneRow
          weeks={weeks}
          label="Team milestone"
          labWide={false}
          onPick={onPick}
          style={columns}
        />

        {domains.map((d) => (
          <div
            key={d.key}
            className={cn(
              grid,
              "mb-2 transition-opacity",
              filter !== ALL && filter !== d.key && "opacity-30",
            )}
            style={columns}
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
            {weeks.map((w, i) => {
              const lane = w.lanes.find((l) => l.domainKey === d.key);
              return (
                <button
                  key={w.index}
                  type="button"
                  onClick={() => onPick(i)}
                  style={{ borderLeft: `4px solid ${d.color}` }}
                  className="min-h-[74px] rounded-xl border border-border bg-card p-2.5 text-left text-xs leading-snug transition-transform hover:-translate-y-0.5"
                >
                  <span className="block font-semibold text-dark-blue dark:text-foreground">
                    {lane?.role ?? ""}
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">
                    {lane?.deliverables[0] ?? ""}
                  </span>
                </button>
              );
            })}
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
  weeks,
  label,
  labWide,
  onPick,
  style,
}: {
  weeks: TimelineWeekView[];
  label: string;
  labWide: boolean;
  onPick: (i: number) => void;
  style: React.CSSProperties;
}) {
  return (
    <div className={cn("grid gap-2", labWide ? "mb-2" : "mb-4")} style={style}>
      <div
        className={cn(
          "flex items-center text-[11.5px] font-bold uppercase leading-tight tracking-[0.06em]",
          labWide ? "text-accent-coral" : "text-accent-coral/80",
        )}
      >
        {label}
      </div>
      {weeks.map((w, i) => {
        const names = w.milestones.filter((m) => m.labWide === labWide).map((m) => m.name);
        return (
          <button
            key={w.index}
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
