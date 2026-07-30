import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import { Download, Eye, X } from "lucide-react";
import { termCodeLabel } from "~/lib/display";
import { formatBytes } from "~/lib/upload-client";
import { Avatar } from "~/components/ui/Avatar";
import { Markdown } from "~/components/Markdown";
import { Modal } from "~/components/Modal";
import { CommentsRail } from "~/components/collab/CommentsRail";
import { PartnerBackLink } from "~/partners/components/PartnerBackLink";
import { PartnerWeekCalendar } from "~/partners/components/PartnerWeekCalendar";
import { ProjectCoverImage } from "~/projects/components/ProjectCoverImage";
import { ProjectIcon } from "~/components/ProjectIcon";
import type {
  PartnerProjectEpic,
  PartnerProjectSprint,
  PartnerProjectStory,
  PartnerProjectViewData,
  PartnerWorkState,
} from "~/partners/lib/partner-project-view.server";

type SharedFile = PartnerProjectViewData["sharedFiles"][number];

// Types the browser can render inline (image/pdf/text). Everything else is
// download-only, so the row offers Download rather than Preview.
function isPreviewable(contentType: string | null): boolean {
  const ct = contentType ?? "";
  return (
    ct.startsWith("image/") ||
    ct === "application/pdf" ||
    ct.startsWith("text/") ||
    ct === "application/json"
  );
}

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

const STORY_PRIORITY_TONE: Record<
  NonNullable<PartnerProjectStory["priority"]>,
  string
> = {
  Must: "text-accent-coral font-semibold",
  Should: "text-foreground",
  Could: "text-muted-foreground",
  Wont: "text-muted-foreground line-through",
};

// Scope: the product requirements the epic delivers, as a read-only table with
// every column partners can see (success metric, acceptance criteria, etc.).
function StoryList({ stories }: { stories: PartnerProjectStory[] }) {
  if (stories.length === 0) return null;
  const done = stories.filter((s) => s.status === "Done").length;
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
        Requirements · {done}/{stories.length} done
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <th className="py-1.5 pr-3">Requirement</th>
              <th className="py-1.5 px-3">Category</th>
              <th className="py-1.5 px-3">Priority</th>
              <th className="py-1.5 px-3">Success metric</th>
              <th className="py-1.5 px-3">Acceptance criteria</th>
              <th className="py-1.5 pl-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {stories.map((story) => (
              <tr key={story.id} className="border-b border-border/60 align-top">
                <td
                  className={`min-w-[160px] py-2 pr-3 ${
                    story.status === "Done"
                      ? "text-muted-foreground line-through"
                      : "text-foreground"
                  }`}
                >
                  {story.title}
                </td>
                <td className="py-2 px-3 text-muted-foreground">
                  {story.category ?? "—"}
                </td>
                <td className="py-2 px-3">
                  {story.priority ? (
                    <span className={`text-xs ${STORY_PRIORITY_TONE[story.priority]}`}>
                      {story.priority}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="max-w-[220px] whitespace-pre-wrap py-2 px-3 text-muted-foreground">
                  {story.successMetric ?? "—"}
                </td>
                <td className="max-w-[220px] whitespace-pre-wrap py-2 px-3 text-muted-foreground">
                  {story.acceptanceCriteria ?? "—"}
                </td>
                <td className="whitespace-nowrap py-2 pl-3 text-[11px] text-muted-foreground">
                  {story.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

// Hero readout: names the live sprint and shows how far along it is + when it
// wraps — a partner's "where are we right now" glance.
function MomentumReadout({
  momentum,
}: {
  momentum: NonNullable<PartnerProjectViewData["momentum"]>;
}) {
  const pct =
    momentum.total > 0 ? Math.round((momentum.done / momentum.total) * 100) : 0;
  const timing =
    momentum.daysLeft > 0
      ? `${momentum.daysLeft} day${momentum.daysLeft === 1 ? "" : "s"} left`
      : "due now";
  return (
    <div className="rounded-2xl bg-brand-tint px-5 py-4 sm:min-w-[13rem]">
      <p className="text-xs font-medium uppercase tracking-wide text-accent-teal">
        Current sprint
      </p>
      <p className="mt-1 font-heading font-bold text-dark-blue text-lg leading-snug">
        {momentum.label}
      </p>
      {momentum.total > 0 && (
        <div className="mt-2 h-1.5 rounded-full bg-white/60 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-teal"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">
        {momentum.total > 0 ? `${momentum.done}/${momentum.total} tasks · ` : ""}
        {timing}
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
  currentUserId,
  backLink,
  pageHref,
  calendarFeedUrl,
  canRsvp = false,
  meetingRequested = false,
  requestError = null,
}: {
  data: PartnerProjectViewData;
  currentUserId: string;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
  // Personal ICS subscribe URL (real portal only; absent in the member preview).
  calendarFeedUrl?: string | null;
  // Whether RSVP + request-a-meeting controls are live (real portal only).
  canRsvp?: boolean;
  // Request-a-meeting action feedback (real portal only).
  meetingRequested?: boolean;
  requestError?: string | null;
}) {
  const {
    project,
    partnerSince,
    currentTermCode,
    team,
    momentum,
    epics,
    ungroupedSprints,
    nextSprint,
    recentlyDone,
    sharedPages,
    sharedFiles,
    meetings,
    milestones,
  } = data;

  const hasUpcoming = meetings.length > 0 || milestones.length > 0;

  const hasWork = epics.length > 0 || ungroupedSprints.length > 0;

  // Shared-file inline preview (mirrors the internal file view): clicking a
  // file opens it in a modal — image/PDF inline, everything else a download.
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);

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
    ...(hasUpcoming ? [{ id: "upcoming", label: "Upcoming" }] : []),
    { id: "roadmap", label: "Roadmap" },
    ...(recentlyDone.length > 0
      ? [{ id: "recently-completed", label: "Completed work" }]
      : []),
    { id: "shared-documents", label: "Shared documents" },
    { id: "shared-files", label: "Shared files" },
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
          <ProjectCoverImage
            name={project.name}
            imageUrl={project.imageUrl}
            className="w-full h-40 object-cover"
            placeholderClassName="w-full h-40"
          />
          <div className="p-5">
            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 font-heading text-3xl font-bold text-dark-blue">
                  <ProjectIcon iconEmoji={project.iconEmoji} size="lg" />
                  <span className="min-w-0 truncate">{project.name}</span>
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
      {(hasUpcoming || canRsvp) && (
        <section id="upcoming" className="scroll-mt-24">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-heading text-lg font-semibold text-dark-blue">
              Upcoming
            </h2>
            {hasUpcoming && calendarFeedUrl && (
              <a
                href={calendarFeedUrl}
                className="text-xs font-medium text-accent-coral hover:underline"
                title="Add to Google, Outlook, or Apple Calendar"
              >
                Subscribe to calendar
              </a>
            )}
          </div>
          <PartnerWeekCalendar
            meetings={meetings}
            milestones={milestones}
            pageHref={pageHref}
            canRsvp={canRsvp}
          />
          {canRsvp && (
            <div className="mt-4">
              <RequestMeetingForm
                requested={meetingRequested}
                error={requestError}
              />
            </div>
          )}
        </section>
      )}

      {/* The roadmap — active epics by default, each showing its stories
          (scope) and its sprints across past, current, and planned. Backlog
          and done epics live behind the "Show all" toggle. */}
      <section id="roadmap" className="scroll-mt-24">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3 min-w-0">
            <h2 className="font-heading text-lg font-semibold text-dark-blue">
              Roadmap
            </h2>
            {nextSprint && (
              <span className="text-xs text-muted-foreground truncate">
                Up next: {nextSprint.name}
              </span>
            )}
          </div>
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
            Completed work
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
      <section id="shared-files" className="scroll-mt-24">
        <h2 className="font-heading text-lg font-semibold text-dark-blue mb-3">
          Shared files
        </h2>
        {sharedFiles.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground">
            The team hasn't shared any files yet.
          </div>
        ) : (
          <ul className="bg-card border border-border rounded-2xl divide-y divide-border">
            {sharedFiles.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setPreviewFile(f)}
                  disabled={!f.downloadUrl}
                  className={`w-full text-left px-4 py-3 flex items-center gap-3 text-sm transition ${
                    f.downloadUrl
                      ? "hover:bg-muted/20 cursor-pointer"
                      : "opacity-60 cursor-not-allowed"
                  }`}
                >
                  {isPreviewable(f.contentType) ? (
                    <Eye className="w-4 h-4 text-accent-teal flex-shrink-0" />
                  ) : (
                    <Download className="w-4 h-4 text-accent-teal flex-shrink-0" />
                  )}
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
                    {!f.downloadUrl
                      ? "Unavailable"
                      : isPreviewable(f.contentType)
                        ? "Preview"
                        : "Download"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

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

      {previewFile && (
        <SharedFilePreviewModal
          file={previewFile}
          currentUserId={currentUserId}
          onClose={() => setPreviewFile(null)}
        />
      )}
        </div>
      </div>
    </div>
  );
}

// Inline preview of a shared file (parity with the internal file view).
// Images and PDFs render from the short-lived signed URL; anything else falls
// back to a download prompt. Download stays one click away in the header.
function SharedFilePreviewModal({
  file,
  currentUserId,
  onClose,
}: {
  file: SharedFile;
  currentUserId: string;
  onClose: () => void;
}) {
  const ct = file.contentType ?? "";
  // Inline preview uses the content-type-forced URL; the Download button uses
  // the plain attachment URL. Fall back to the download URL if no preview URL.
  const previewSrc = file.previewUrl ?? file.downloadUrl ?? undefined;
  const url = file.downloadUrl ?? undefined;
  const isImage = ct.startsWith("image/");
  const isPdf = ct === "application/pdf";
  const isText = ct.startsWith("text/") || ct === "application/json";

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="shared-file-preview-title"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-3xl w-full p-5 sm:p-6 my-auto max-h-[85vh] flex flex-col"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2
          id="shared-file-preview-title"
          className="text-lg font-semibold text-foreground min-w-0 truncate"
        >
          {file.title}
        </h2>
        <div className="flex items-center gap-3 flex-shrink-0">
          {url && (
            <a
              href={url}
              download={file.fileName ?? undefined}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent-teal hover:underline"
            >
              <Download className="w-4 h-4" />
              Download
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground/70 hover:text-foreground rounded p-1 hover:bg-muted"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        {isImage ? (
          <img
            src={previewSrc}
            alt={file.title}
            className="max-w-full max-h-[70vh] mx-auto rounded-lg border border-border object-contain bg-muted/20"
          />
        ) : isPdf || isText ? (
          <iframe
            src={previewSrc}
            title={file.title}
            className="w-full h-[70vh] rounded-lg border border-border bg-white"
          />
        ) : (
          <div className="rounded-lg border border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
            <p>
              No inline preview for this file type
              {file.contentType ? ` (${file.contentType})` : ""}.
            </p>
            {url && (
              <a
                href={url}
                download={file.fileName ?? undefined}
                className="mt-3 inline-flex items-center gap-1 text-accent-teal hover:underline"
              >
                <Download className="w-3.5 h-3.5" />
                Download to view
              </a>
            )}
          </div>
        )}

        {/* Feedback thread on the shared file — the partner's channel to
            comment on a deliverable. Read-only resolve (the team resolves). */}
        <div className="mt-5 border-t border-border pt-4">
          <CommentsRail
            targetType="file"
            targetId={file.id}
            currentUserId={currentUserId}
            canComment
            canResolve={false}
          />
        </div>
      </div>
    </Modal>
  );
}

function RequestMeetingForm({
  requested,
  error,
}: {
  requested: boolean;
  error: string | null;
}) {
  const [open, setOpen] = useState(false);
  const inputClass =
    "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-coral";
  if (requested) {
    return (
      <p className="mt-3 text-sm text-accent-teal bg-accent-teal/10 rounded-lg px-4 py-3">
        Request sent — the team will follow up to schedule.
      </p>
    );
  }
  return (
    <div className="mt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-accent-coral hover:underline"
        >
          + Request a meeting
        </button>
      ) : (
        <Form
          method="post"
          className="bg-card border border-border rounded-2xl p-4 flex flex-col gap-3"
        >
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              What's it about?
            </label>
            <input
              name="topic"
              required
              placeholder="e.g. Mid-sprint check-in"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Preferred times <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              name="preferredWindows"
              placeholder="e.g. Weekday afternoons ET"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Anything else? <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea name="details" rows={2} className={inputClass} />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="self-start rounded-lg bg-dark-blue text-white text-sm font-heading font-semibold px-4 py-2 hover:opacity-90 transition"
            >
              Send request
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </Form>
      )}
    </div>
  );
}
