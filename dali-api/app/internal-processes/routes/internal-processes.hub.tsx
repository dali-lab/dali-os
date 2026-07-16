import { Fragment, useMemo, useState, type CSSProperties } from "react";
import { Link, redirect, useFetcher, useLoaderData, useSearchParams } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/internal-processes.hub";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden, redirectApplicantToPortal } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { labProcessesPills } from "~/internal-processes/labProcessesPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { Pencil } from "lucide-react";
import { cn } from "~/lib/cn";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [{ title: "Lab Processes · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  const overrideRows = await prisma.labProcessWeekContent.findMany({
    select: { week: true, title: true, summary: true, highlights: true },
  });
  return {
    isCore: await isCore(auth.user.sub),
    overrides: overrideRows,
  };
}

const UpdateWeekContentSchema = z.object({
  intent: z.literal("update-week-content"),
  week: z.number().int().min(0).max(10),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(500),
  highlights: z.array(z.string().trim().min(1).max(200)).max(10),
});

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const raw = await request.json();
  const parsed = UpdateWeekContentSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { week, title, summary, highlights } = parsed.data;

  await prisma.labProcessWeekContent.upsert({
    where: { week },
    create: { week, title, summary, highlights, updatedByUserId: auth.user.sub },
    update: { title, summary, highlights, updatedByUserId: auth.user.sub },
  });
  return { ok: true };
}

type WeekMeta = {
  week: number;
  title: string;
  summary: string;
  highlights: string[];
  links?: { label: string; to: string; coreOnly?: boolean }[];
};

type RoadPt = { x: number; y: number; w: number };
type Point = { x: number; y: number };

const VB_W = 1400;
const VB_H = 3200;

// Thick S-road that continues past the frame (start below bottom, end past top-right).
 // Half-width stays chunky; points use wide radii so bends stay round.
const ROAD_CENTER: RoadPt[] = [
  // — enters from below the bottom edge —
  { x: 180, y: 3480, w: 160 },
  { x: 220, y: 3340, w: 155 },
  { x: 280, y: 3180, w: 150 },
  // on-canvas
  { x: 360, y: 2980, w: 145 },
  { x: 480, y: 2780, w: 140 },
  { x: 640, y: 2600, w: 136 },
  { x: 820, y: 2440, w: 132 },
  { x: 980, y: 2280, w: 128 },
  { x: 1100, y: 2120, w: 124 },
  { x: 1160, y: 1960, w: 120 },
  // soft apex — broad left swing
  { x: 1120, y: 1820, w: 118 },
  { x: 1000, y: 1700, w: 116 },
  { x: 840, y: 1600, w: 114 },
  { x: 680, y: 1500, w: 112 },
  { x: 540, y: 1380, w: 110 },
  { x: 460, y: 1240, w: 108 },
  { x: 440, y: 1100, w: 104 },
  // soft trough — broad right swing
  { x: 500, y: 980, w: 100 },
  { x: 620, y: 880, w: 96 },
  { x: 780, y: 800, w: 92 },
  { x: 940, y: 720, w: 88 },
  { x: 1080, y: 620, w: 84 },
  { x: 1160, y: 500, w: 80 },
  { x: 1140, y: 380, w: 78 },
  { x: 1060, y: 280, w: 76 },
  { x: 1040, y: 180, w: 74 },
  { x: 1120, y: 100, w: 72 },
  { x: 1240, y: 40, w: 70 },
  // — exits past the top-right edge —
  { x: 1380, y: -40, w: 68 },
  { x: 1520, y: -140, w: 66 },
];

/** Weeks on the visible road only, with headroom under the title.
 *  Order is top → bottom so Week 0 is highest and Week 10 is lowest (counts up as you scroll down). */
function sampleWeeksOnCanvas(pts: RoadPt[], count: number): Point[] {
  const topPad = VB_H * 0.08; // modest headroom under the title
  const botPad = 100;
  const visible = pts.filter((p) => p.y >= topPad && p.y <= VB_H - botPad);
  const along = sampleAlongRoad(visible.length >= 2 ? visible : pts, count);
  // Path is drawn bottom → top; reverse so week index 0 lands near the top.
  return along.slice().reverse();
}

const WEEK_META: WeekMeta[] = [
  {
    week: 0,
    title: "Pre-term warmup",
    summary:
      "Logistics and contact",
    highlights: [
      "PM gathers user contacts from partner and reaches out to schedule user interviews",
      "PM ",
      "PM / Core staffing kickoffs",
    ],
    links: [
      { label: "Onboarding board", to: "/internal-processes/onboarding", coreOnly: true },
    ],
  },
  {
    week: 1,
    title: "Kickoff week",
    summary:
      "Teams form, partners meet the crew, and every project writes down goals for the term.",
    highlights: [
      "All-hands kickoff",
      "Team intros + partner discovery",
      "Set term OKRs / epic outline",
    ],
  },
  {
    week: 2,
    title: "Settle into cadence",
    summary:
      "Weekly rituals lock in: team meetings, mentor hours, and the first delivery milestones.",
    highlights: [
      "Recurring team meeting",
      "Stand up the task board",
      "First mentor check-ins",
    ],
  },
  {
    week: 3,
    title: "Build momentum",
    summary:
      "Design and engineering dig into the core build. Transfers and JobX swaps can still land early.",
    highlights: [
      "Ship first usable slice",
      "Design reviews for core flows",
      "Late domain transfers if needed",
    ],
    links: [
      { label: "Transfer", to: "/internal-processes/transfer" },
      { label: "JobX", to: "/internal-processes/jobx" },
    ],
  },
  {
    week: 4,
    title: "Mid-build checkpoint",
    summary:
      "Halfway through the first half — surface blockers early and realign with the partner.",
    highlights: [
      "Partner sync / demo",
      "Scope trim or expand",
      "Peer feedback loops",
    ],
  },
  {
    week: 5,
    title: "Midterm mark",
    summary:
      "The midpoint of the term. Reconfirm what ships before Technigala and what slips.",
    highlights: [
      "Midterm retro",
      "Update epics / sprints",
      "Staffing adjustments for half B",
    ],
  },
  {
    week: 6,
    title: "Second wind",
    summary:
      "Fresh energy after midterm. Push the hardest features while there's still runway.",
    highlights: [
      "Hard features first",
      "QA backlog starts",
      "Mentor pairing on sticky bugs",
    ],
  },
  {
    week: 7,
    title: "Integration week",
    summary:
      "Pieces come together. Cross-domain reviews catch gaps before polish week.",
    highlights: [
      "End-to-end walkthroughs",
      "Dev ↔ design critique",
      "Content freeze list",
    ],
  },
  {
    week: 8,
    title: "Polish & harden",
    summary:
      "Bugs, copy, accessibility, and deployment. Partner UAT if the project needs it.",
    highlights: [
      "Bug bash",
      "Deploy staging → prod path",
      "Partner UAT (if scheduled)",
    ],
  },
  {
    week: 9,
    title: "Showcase prep",
    summary:
      "Slides, demo scripts, and attribution. Practice the story you'll tell at Technigala.",
    highlights: [
      "Demo script + dry run",
      "Attribution + writeups",
      "Hand-off notes for next term",
    ],
  },
  {
    week: 10,
    title: "Technigala & wrap",
    summary:
      "Show the work, celebrate the term, and close out repos, docs, and partner next steps.",
    highlights: [
      "Technigala showcase",
      "Final partner hand-off",
      "Term retro + shoutouts",
    ],
  },
];

function buildRoadPaths(pts: RoadPt[]) {
  const left: Point[] = [];
  const right: Point[] = [];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    left.push({ x: p.x + nx * p.w, y: p.y + ny * p.w });
    right.push({ x: p.x - nx * p.w, y: p.y - ny * p.w });
  }

  const curveThrough = (points: Point[]) => {
    if (points.length === 0) return "";
    if (points.length === 1) {
      return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
    }
    let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;
      const cp1x = p1.x + (p2.x - p0.x) / 10;
      const cp1y = p1.y + (p2.y - p0.y) / 10;
      const cp2x = p2.x - (p3.x - p1.x) / 10;
      const cp2y = p2.y - (p3.y - p1.y) / 10;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const revRight = [...right].reverse();
  const fill =
    curveThrough(left) +
    ` L ${revRight[0]!.x.toFixed(1)} ${revRight[0]!.y.toFixed(1)}` +
    curveThrough(revRight).replace(/^M\s+[\d.-]+\s+[\d.-]+/, "") +
    " Z";
  const center = curveThrough(pts.map((p) => ({ x: p.x, y: p.y })));
  return { fill, center };
}

function sampleAlongRoad(pts: RoadPt[], count: number): Point[] {
  const segs: { x: number; y: number; dist: number }[] = [];
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) {
      total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    }
    segs.push({ x: pts[i]!.x, y: pts[i]!.y, dist: total });
  }
  const out: Point[] = [];
  for (let i = 0; i < count; i++) {
    const target = (total * i) / Math.max(1, count - 1);
    let j = 1;
    while (j < segs.length - 1 && segs[j]!.dist < target) j++;
    const a = segs[j - 1]!;
    const b = segs[j]!;
    const span = b.dist - a.dist || 1;
    const t = (target - a.dist) / span;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

const { fill: ROAD_FILL, center: ROAD_CENTER_D } = buildRoadPaths(ROAD_CENTER);
const WEEK_POINTS = sampleWeeksOnCanvas(ROAD_CENTER, WEEK_META.length);

const WEEKS = WEEK_META.map((meta, i) => {
  const p = WEEK_POINTS[i]!;
  return {
    ...meta,
    xPct: (p.x / VB_W) * 100,
    yPct: (p.y / VB_H) * 100,
  };
});

const NAVY = "#1E5779";
const YELLOW = "#FFD461";
const PINK = "#E68FBE";
const CORAL = "#FF8B81";
const TEAL = "#00ADAB";
const WHITE = "#FFFFFF";

export default function LabProcessesHub() {
  const { isCore: core, overrides } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedWeek, setSelectedWeek] = useState(() =>
    clampWeek(Number(searchParams.get("week"))),
  );
  const [contentTick, setContentTick] = useState(0);
  const [editingWeek, setEditingWeek] = useState(false);

  const overridesByWeek = useMemo(
    () => new Map(overrides.map((o) => [o.week, o])),
    [overrides],
  );

  const stop = useMemo(() => {
    const base = WEEKS.find((w) => w.week === selectedWeek) ?? WEEKS[0]!;
    const override = overridesByWeek.get(base.week);
    return override
      ? { ...base, title: override.title, summary: override.summary, highlights: override.highlights }
      : base;
  }, [selectedWeek, overridesByWeek]);
  const links = (stop.links ?? []).filter((l) => !l.coreOnly || core);

  function selectWeek(week: number) {
    setSelectedWeek(week);
    setContentTick((n) => n + 1);
    const next = new URLSearchParams(searchParams);
    next.set("week", String(week));
    setSearchParams(next, { replace: true, preventScrollReset: true });
  }

  return (
    <div className="-mx-3 sm:-mx-6 lg:-mx-10 -mb-6 sm:-mb-8 flex flex-col">
      <style>{`
        @keyframes lp-content-in {
          from { opacity: 0; transform: translateY(calc(-50% + 12px)) scale(0.98); }
          to { opacity: 1; transform: translateY(-50%) scale(1); }
        }
        .lp-week-btn {
          transform: translate(-50%, -50%);
        }
        .lp-content-card {
          animation: lp-content-in 0.35s ease both;
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-content-card {
            animation: none !important;
            opacity: 1 !important;
            transform: translateY(-50%) !important;
          }
        }
      `}</style>

      <AreaPillNav
        items={labProcessesPills({ isCore: core, active: "hub" })}
        className="relative z-40 !mx-0 !mb-0 shrink-0"
      />

      <section
        aria-label="Term roadmap"
        className="relative w-full overflow-hidden"
        style={{ backgroundColor: YELLOW }}
      >
        <div className="relative w-full" style={{ aspectRatio: `${VB_W} / ${VB_H}` }}>
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <path d={ROAD_FILL} fill={PINK} />
            <path d={ROAD_FILL} fill={CORAL} fillOpacity="0.22" />
            <path
              d={ROAD_CENTER_D}
              fill="none"
              stroke={WHITE}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray="28 24"
              opacity="0.95"
            />
          </svg>

          <div className="pointer-events-none absolute left-1/2 top-[1.5%] z-20 w-[min(92%,40rem)] -translate-x-1/2 text-center">
            <h1
              className="font-heading text-2xl font-bold leading-tight sm:text-4xl"
              style={{ color: NAVY }}
            >
              Lab Processes
            </h1>
          </div>

          {WEEKS.map((w) => {
            const active = w.week === selectedWeek;
            const cardOnLeft = w.xPct > 52;
            return (
              <Fragment key={w.week}>
                <button
                  type="button"
                  onClick={() => selectWeek(w.week)}
                  aria-pressed={active}
                  aria-label={`Week ${w.week}: ${w.title}`}
                  className={cn(
                    "lp-week-btn absolute z-10",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                    active && "z-20",
                  )}
                  style={
                    {
                      left: `${w.xPct}%`,
                      top: `${w.yPct}%`,
                      "--tw-ring-color": NAVY,
                      "--tw-ring-offset-color": YELLOW,
                    } as CSSProperties
                  }
                >
                  <span
                    className={cn(
                      "flex h-14 w-14 flex-col items-center justify-center rounded-full font-heading sm:h-16 sm:w-16 md:h-[4.5rem] md:w-[4.5rem]",
                      "transition-transform duration-200",
                      active ? "scale-110" : "hover:scale-105",
                    )}
                    style={
                      active
                        ? {
                            backgroundColor: TEAL,
                            color: WHITE,
                            boxShadow: `0 0 0 3px ${WHITE}, 0 8px 20px rgba(8,35,48,0.18)`,
                          }
                        : {
                            backgroundColor: WHITE,
                            color: NAVY,
                            boxShadow: `0 0 0 2px ${NAVY}`,
                          }
                    }
                  >
                    <span className="text-[10px] font-bold uppercase leading-none opacity-80 sm:text-xs">
                      Wk
                    </span>
                    <span className="text-lg font-bold leading-none sm:text-xl md:text-2xl">
                      {w.week}
                    </span>
                  </span>
                </button>

                {active && (
                  <div
                    key={`${w.week}-${contentTick}`}
                    className="lp-content-card absolute z-30 w-[min(18rem,46vw)] rounded-xl p-3 shadow-[var(--shadow-2)] sm:w-[20rem] sm:p-4"
                    style={{
                      backgroundColor: WHITE,
                      top: `${w.yPct}%`,
                      ...(cardOnLeft
                        ? { right: `${Math.max(2, 100 - w.xPct + 4)}%` }
                        : { left: `${Math.min(54, w.xPct + 5)}%` }),
                    }}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-heading font-bold uppercase tracking-wide"
                        style={{ backgroundColor: `${TEAL}33`, color: NAVY }}
                      >
                        Week {stop.week}
                      </span>
                      <h2 className="font-heading text-base font-bold sm:text-lg" style={{ color: NAVY }}>
                        {stop.title}
                      </h2>
                      {core && (
                        <button
                          type="button"
                          onClick={() => setEditingWeek(true)}
                          aria-label={`Edit week ${stop.week} content`}
                          title="Edit week content"
                          className="ml-auto shrink-0 rounded-md p-1 text-current/60 hover:bg-black/5"
                          style={{ color: NAVY }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed sm:text-sm" style={{ color: "#404040" }}>
                      {stop.summary}
                    </p>
                    <ul className="mt-2.5 flex flex-col gap-1">
                      {stop.highlights.map((h) => (
                        <li key={h} className="flex gap-2 text-xs sm:text-sm" style={{ color: NAVY }}>
                          <span
                            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ backgroundColor: CORAL }}
                          />
                          {h}
                        </li>
                      ))}
                    </ul>
                    {links.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {links.map((l) => (
                          <Link
                            key={l.to}
                            to={l.to}
                            className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                            style={{ backgroundColor: CORAL }}
                          >
                            {l.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </section>

      {core && editingWeek && (
        <WeekEditModal
          week={stop.week}
          title={stop.title}
          summary={stop.summary}
          highlights={stop.highlights}
          onClose={() => setEditingWeek(false)}
        />
      )}
    </div>
  );
}

function WeekEditModal({
  week,
  title,
  summary,
  highlights,
  onClose,
}: {
  week: number;
  title: string;
  summary: string;
  highlights: string[];
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const [titleVal, setTitleVal] = useState(title);
  const [summaryVal, setSummaryVal] = useState(summary);
  const [highlightsVal, setHighlightsVal] = useState(highlights.join("\n"));
  const submitting = fetcher.state !== "idle";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    fetcher.submit(
      {
        intent: "update-week-content",
        week,
        title: titleVal.trim(),
        summary: summaryVal.trim(),
        highlights: highlightsVal
          .split("\n")
          .map((h) => h.trim())
          .filter(Boolean),
      },
      { method: "post", encType: "application/json" },
    );
  }

  // Close once the update lands.
  useMemo(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as { ok?: boolean }).ok) {
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const canSubmit = titleVal.trim().length > 0 && summaryVal.trim().length > 0 && !submitting;

  return (
    <Modal open onClose={onClose} labelledBy="week-edit-title">
      <ModalHeader titleId="week-edit-title" title={`Edit Week ${week}`} onClose={onClose} />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-medium text-foreground">
          Title
          <input
            type="text"
            value={titleVal}
            onChange={(e) => setTitleVal(e.target.value)}
            required
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Summary
          <textarea
            value={summaryVal}
            onChange={(e) => setSummaryVal(e.target.value)}
            required
            rows={3}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        <label className="text-sm font-medium text-foreground">
          Highlights <span className="text-muted-foreground font-normal">(one per line)</span>
          <textarea
            value={highlightsVal}
            onChange={(e) => setHighlightsVal(e.target.value)}
            rows={4}
            className="mt-1 w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
        </label>
        {fetcher.data && (fetcher.data as { error?: string }).error && (
          <p className="text-sm text-red-700">{(fetcher.data as { error?: string }).error}</p>
        )}
        <ModalFooter onCancel={onClose}>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

function clampWeek(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, Math.round(n)));
}
