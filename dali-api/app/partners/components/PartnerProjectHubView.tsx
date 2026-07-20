import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Download } from "lucide-react";
import { termCodeLabel } from "~/lib/display";
import { formatBytes } from "~/lib/upload-client";
import { Avatar } from "~/components/ui/Avatar";
import { Markdown } from "~/components/Markdown";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import type {
  PartnerProjectEpic,
  PartnerProjectSprint,
  PartnerProjectStory,
  PartnerProjectViewData,
  PartnerWorkState,
} from "~/partners/lib/partner-project-view.server";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const EPIC_STATUS_LABEL: Record<PartnerProjectEpic["status"], string> = {
  Backlog: "Backlog",
  Open: "Open",
  InProgress: "In progress",
  Done: "Done",
  Cancelled: "Cancelled",
};

// Colour language, matched to the internal EpicsTimeline so both hubs read the
// same way: coral is the epic hue, teal the sprint hue, and a story inherits
// its epic's coral. Work that hasn't started is muted/dashed; finished work
// fades. Every pill also carries a word, so hue never has to carry state alone.
const EPIC_PILL: Record<PartnerProjectEpic["status"], string> = {
  Backlog: "bg-muted text-muted-foreground",
  Open: "bg-accent-coral/10 text-accent-coral",
  InProgress: "bg-accent-coral/10 text-accent-coral",
  Done: "bg-accent-coral/10 text-accent-coral/70",
  Cancelled: "bg-muted text-muted-foreground",
};

// Story dots inherit the epic's coral: dashed grey before it starts, solid
// coral in progress, faded coral once done.
const STORY_DOT: Record<PartnerProjectStory["status"], string> = {
  Todo: "border-2 border-dashed border-brand-gray",
  InProgress: "bg-accent-coral",
  Done: "bg-accent-coral/50",
};

const sprintState = (s: PartnerProjectSprint): PartnerWorkState =>
  s.status === "Active" ? "current" : s.status === "Planned" ? "planned" : "past";

// Scope: what the epic delivers. Done stories read as struck-through history.
function StoryList({ stories }: { stories: PartnerProjectStory[] }) {
  if (stories.length === 0) return null;
  const done = stories.filter((s) => s.status === "Done").length;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Stories · {done}/{stories.length} done
      </p>
      <ul className="flex flex-col gap-1.5">
        {stories.map((story) => (
          <li key={story.id} className="flex items-center gap-2 text-sm">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${STORY_DOT[story.status]}`}
            />
            <span
              className={`min-w-0 truncate ${
                story.status === "Done"
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              }`}
            >
              {story.title}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A live or upcoming sprint — the sprints a partner should actually look at.
// Active sprints carry a teal progress bar (teal is the sprint hue); planned
// ones stay dashed and quiet until they start.
function SprintCard({ s }: { s: PartnerProjectSprint }) {
  const state = sprintState(s);
  const total = s.done + s.open;
  const pct = total > 0 ? Math.round((s.done / total) * 100) : 0;
  return (
    <div
      className={`rounded-xl p-4 ${
        state === "current"
          ? "bg-accent-teal/5 border border-accent-teal/30"
          : "border border-dashed border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-heading font-semibold text-dark-blue text-sm">
          {s.name}
        </span>
        <span
          className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${
            state === "current"
              ? "bg-accent-teal/15 text-accent-teal"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {state === "current" ? "In progress" : "Planned"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {fmtDate(s.startsAt)} – {fmtDate(s.endsAt)}
      </p>
      {state === "current" && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>
              {s.done} of {total} tasks done
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-accent-teal rounded-full"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      {state === "planned" && total > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          {total} task{total === 1 ? "" : "s"} queued
        </p>
      )}
    </div>
  );
}

// A wrapped sprint — history, so it collapses to one settled line.
function PastSprintRow({ s }: { s: PartnerProjectSprint }) {
  const total = s.done + s.open;
  return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <span className="text-accent-teal flex-shrink-0">✓</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}</span>
      <span className="text-xs text-muted-foreground flex-shrink-0">
        {s.done}/{total} · {fmtDate(s.endsAt)}
      </span>
    </div>
  );
}

// Sprints of one epic (or the epic-less bucket), ordered by attention: what's
// live, then what's next, then completed history tucked behind a disclosure.
function SprintGroup({ sprints }: { sprints: PartnerProjectSprint[] }) {
  if (sprints.length === 0) return null;
  const current = sprints.filter((s) => sprintState(s) === "current");
  const planned = sprints.filter((s) => sprintState(s) === "planned");
  const past = sprints.filter((s) => sprintState(s) === "past");
  return (
    <div className="flex flex-col gap-3 border-l-2 border-border pl-4">
      {current.map((s) => (
        <SprintCard key={s.id} s={s} />
      ))}
      {planned.map((s) => (
        <SprintCard key={s.id} s={s} />
      ))}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">
            {past.length} completed sprint{past.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-1 flex flex-col divide-y divide-border">
            {past.map((s) => (
              <PastSprintRow key={s.id} s={s} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function EpicCard({ epic }: { epic: PartnerProjectEpic }) {
  return (
    <div className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-heading font-semibold text-dark-blue text-base">
            {epic.title}
          </h3>
          <span className={`text-xs rounded-full px-2 py-0.5 flex-shrink-0 ${EPIC_PILL[epic.status]}`}>
            {EPIC_STATUS_LABEL[epic.status]}
          </span>
        </div>
        {epic.startsAt && epic.endsAt && (
          <p className="text-xs text-muted-foreground mt-1">
            {fmtDate(epic.startsAt)} – {fmtDate(epic.endsAt)}
          </p>
        )}
      </div>
      <StoryList stories={epic.stories} />
      <SprintGroup sprints={epic.sprints} />
    </div>
  );
}

// Hero readout: names the live sprint so a partner lands on "where are we
// right now" before anything else.
function MomentumReadout({
  momentum,
}: {
  momentum: NonNullable<PartnerProjectViewData["momentum"]>;
}) {
  return (
    <div className="rounded-2xl bg-brand-tint px-5 py-4 sm:min-w-[13rem]">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-teal">
        Current sprint
      </p>
      <p className="mt-1 font-heading font-bold text-dark-blue text-lg leading-snug">
        {momentum.label}
      </p>
    </div>
  );
}

type NavSection = { id: string; label: string };

// Tracks which section is currently in view so the side nav can highlight it.
// Picks the topmost section whose top has scrolled past the header band.
function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");
  useEffect(() => {
    const els = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Active band sits just below the fixed navbar; a section counts once its
      // top clears the header and before it leaves the upper 40% of the view.
      { rootMargin: "-96px 0px -60% 0px" },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

// In-page table of contents. Sticky beside the sections on wide screens;
// hidden on narrow ones, where the page just scrolls.
function SectionNav({
  sections,
  active,
}: {
  sections: NavSection[];
  active: string;
}) {
  return (
    <nav className="hidden lg:block lg:w-44 lg:flex-shrink-0 lg:sticky lg:top-20 lg:self-start">
      <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        On this page
      </p>
      <ul className="flex flex-col gap-0.5">
        {sections.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                document
                  .getElementById(s.id)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
              className={`w-full rounded-lg px-3 py-1.5 text-left text-sm transition ${
                active === s.id
                  ? "bg-brand-tint font-medium text-dark-blue"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Renders the partner-facing read surface for a project. Shared by the real
// partner portal (partner.projects.$id.tsx) and the in-app preview any
// signed-in member can open from the project page
// (projects.$id.partner-view.tsx) — same content, different chrome around it
// via `backLink`, and pageHref for shared-document links. `backLink` is
// optional: the in-app preview instead swaps the project page's "Partner
// view" header button for an "Internal view" one (see that route's
// `handle.headerAction`), so it has no back link of its own here.
export function PartnerProjectHubView({
  data,
  backLink,
  pageHref,
}: {
  data: PartnerProjectViewData;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
}) {
  const {
    project,
    partnerSince,
    currentTermCode,
    team,
    momentum,
    epics,
    ungroupedSprints,
    recentlyDone,
    sharedPages,
    sharedFiles,
  } = data;

  const hasWork = epics.length > 0 || ungroupedSprints.length > 0;

  // The roadmap opens on live work — epics that are Open or In progress. The
  // rest (Backlog, Done) sit behind a toggle so a partner isn't wading through
  // finished or not-yet-started epics to see what's happening now.
  const [showAllEpics, setShowAllEpics] = useState(false);
  const activeEpics = epics.filter(
    (e) => e.status === "Open" || e.status === "InProgress",
  );
  const hiddenEpicCount = epics.length - activeEpics.length;
  const visibleEpics = showAllEpics ? epics : activeEpics;

  // Section anchors for the side nav — only the ones actually rendered.
  const sections: NavSection[] = [
    { id: "roadmap", label: "Roadmap" },
    ...(recentlyDone.length > 0
      ? [{ id: "recently-completed", label: "Recently completed" }]
      : []),
    { id: "shared-documents", label: "Shared documents" },
    ...(sharedFiles.length > 0
      ? [{ id: "shared-files", label: "Shared files" }]
      : []),
    ...(team.length > 0 ? [{ id: "team", label: "Team" }] : []),
  ];
  const activeSection = useActiveSection(sections.map((s) => s.id));

  return (
    <div className="flex flex-col gap-8">
      <div>
        {backLink && (
          <PartnerBackLink to={backLink.to} label={backLink.label} />
        )}
        <div
          className={`bg-card border border-border rounded-2xl overflow-hidden ${backLink ? "mt-2" : ""}`}
        >
          {project.imageUrl && (
            <img src={project.imageUrl} alt="" className="w-full h-40 object-cover" />
          )}
          <div className="p-5">
            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-heading text-3xl font-bold text-dark-blue">
                  {project.name}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  {[
                    project.terms.length > 0
                      ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
                      : null,
                    partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {/* Same Markdown renderer as the internal Overview tab, so a
                    description written with formatting reads the same on both
                    surfaces. */}
                {project.description && (
                  <div className="mt-3">
                    <Markdown>{project.description}</Markdown>
                  </div>
                )}
              </div>
              {momentum && (
                <div className="sm:flex-shrink-0">
                  <MomentumReadout momentum={momentum} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="lg:flex lg:items-start lg:gap-8">
        {sections.length > 1 && (
          <SectionNav sections={sections} active={activeSection} />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-8">
      {/* The roadmap — active epics by default, each showing its stories
          (scope) and its sprints across past, current, and planned. Backlog
          and done epics live behind the "Show all" toggle. */}
      <section id="roadmap" className="scroll-mt-24">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-heading text-lg font-semibold text-dark-blue">
            Roadmap
          </h2>
          {hiddenEpicCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllEpics((v) => !v)}
              className="text-xs font-medium text-accent-coral hover:underline"
            >
              {showAllEpics
                ? "Show active only"
                : `Show all epics (${epics.length})`}
            </button>
          )}
        </div>
        {!hasWork ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            Nothing on the roadmap yet. Epics and sprints will appear here once
            the team plans the work.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleEpics.map((epic) => (
              <EpicCard key={epic.id} epic={epic} />
            ))}
            {visibleEpics.length === 0 && (
              <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
                Nothing in progress right now.
                {hiddenEpicCount > 0 && (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={() => setShowAllEpics(true)}
                      className="font-medium text-accent-coral hover:underline"
                    >
                      Show all {epics.length} epic{epics.length === 1 ? "" : "s"}
                    </button>
                    .
                  </>
                )}
              </div>
            )}
            {ungroupedSprints.length > 0 && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="font-heading font-semibold text-dark-blue text-base mb-3">
                  Other sprints
                </h3>
                <SprintGroup sprints={ungroupedSprints} />
              </div>
            )}
          </div>
        )}
      </section>

      {recentlyDone.length > 0 && (
        <section id="recently-completed" className="scroll-mt-24">
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Recently completed
          </h2>
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {recentlyDone.map((t) => (
              <li key={t.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className="text-accent-teal">✓</span>
                <span className="flex-1 min-w-0 truncate text-foreground">{t.title}</span>
                {t.domain && (
                  <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 flex-shrink-0">
                    {t.domain}
                  </span>
                )}
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {fmtDate(t.doneAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Shared docs */}
      <section id="shared-documents" className="scroll-mt-24">
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Shared documents
        </h2>
        {sharedPages.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            The team hasn't shared any documents yet.
          </div>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {sharedPages.map((p) => (
              <li key={p.id}>
                <Link
                  to={pageHref(p.id)}
                  className="px-4 py-3 flex items-center gap-3 text-sm hover:bg-muted/20 transition"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="flex-1 min-w-0 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    Updated {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Shared files — uploads the team has shared, downloaded via a
          short-lived signed URL resolved in the loader. */}
      {sharedFiles.length > 0 && (
        <section id="shared-files" className="scroll-mt-24">
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Shared files
          </h2>
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {sharedFiles.map((f) => (
              <li key={f.id}>
                <a
                  href={f.downloadUrl ?? undefined}
                  download={f.fileName ?? undefined}
                  aria-disabled={!f.downloadUrl}
                  className={`px-4 py-3 flex items-center gap-3 text-sm transition ${
                    f.downloadUrl
                      ? "hover:bg-muted/20"
                      : "pointer-events-none opacity-60"
                  }`}
                >
                  <Download className="w-4 h-4 text-accent-teal flex-shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium text-foreground">
                      {f.title}
                    </span>
                    {(f.fileName || f.sizeBytes != null) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[f.fileName, f.sizeBytes != null ? formatBytes(f.sizeBytes) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {f.downloadUrl ? "Download" : "Unavailable"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Team */}
      {team.length > 0 && (
        <section id="team" className="scroll-mt-24">
          <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
            Your DALI team{currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
          </h2>
          <div className="bg-card border border-border rounded-2xl p-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {team.map((m) => (
              <div key={m.name} className="flex items-center gap-3 min-w-0">
                <Avatar photoUrl={m.photoUrl} name={m.name} size="md" />
                <div className="min-w-0">
                  <span className="font-medium text-dark-blue block truncate">
                    {m.name}
                  </span>
                  <span className="text-xs text-muted-foreground block truncate">
                    {m.domains.join(", ")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
        </div>
      </div>
    </div>
  );
}
