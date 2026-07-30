import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Download,
  Eye,
  FileText,
  Flag,
  X,
} from "lucide-react";
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
  PartnerActivityKind,
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

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// Shared surface tokens so every tab panel reads the same.
const PANEL_HEADING = "font-heading text-lg font-semibold text-dark-blue";
const CARD = "bg-card border border-border rounded-2xl";
const EMPTY_CARD =
  "bg-card border border-border rounded-2xl p-6 text-sm text-muted-foreground";

const PARTNER_TABS = [
  { id: "overview", label: "Overview" },
  { id: "roadmap", label: "Roadmap" },
  { id: "documents", label: "Documents" },
  { id: "meetings", label: "Meetings" },
  { id: "team", label: "Team" },
] as const;
type PartnerTabId = (typeof PARTNER_TABS)[number]["id"];

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

// Scope: the product requirements the epic delivers. Collapsed by default so
// the roadmap leads with outcomes + timeline; a partner who wants the detailed
// requirements (success metric, acceptance criteria, priority) expands it.
function StoryList({ stories }: { stories: PartnerProjectStory[] }) {
  if (stories.length === 0) return null;
  const done = stories.filter((s) => s.status === "Done").length;
  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
        Requirements · {done}/{stories.length} done
      </summary>
      <div className="mt-2 overflow-x-auto">
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
    </details>
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
      <SprintGroup sprints={epic.sprints} />
      <StoryList stories={epic.stories} />
    </div>
  );
}

// Project identity + a factual status line (sprint sequence position + overall
// task completion). No subjective "on track" verdict — just where the work is.
function ProjectHeader({
  project,
  partnerSince,
  progress,
  backLink,
}: {
  project: PartnerProjectViewData["project"];
  partnerSince: string | null;
  progress: PartnerProjectViewData["progress"];
  backLink?: { to: string; label: string };
}) {
  const pct =
    progress.overallTotal > 0
      ? Math.round((progress.overallDone / progress.overallTotal) * 100)
      : 0;
  const phase =
    progress.sprintCount === 0
      ? null
      : progress.sprintsStarted === 0
        ? "Not started yet"
        : `Sprint ${Math.min(progress.sprintsStarted, progress.sprintCount)} of ${progress.sprintCount}`;
  const statusBits = [
    phase,
    progress.overallTotal > 0 ? `${pct}% complete` : null,
  ].filter(Boolean);
  const meta = [
    project.terms.length > 0
      ? `Terms: ${project.terms.map(termCodeLabel).join(", ")}`
      : null,
    partnerSince ? `Partner since ${fmtDate(partnerSince)}` : null,
  ].filter(Boolean);
  return (
    <div>
      {backLink && <PartnerBackLink to={backLink.to} label={backLink.label} />}
      <div className={`${CARD} overflow-hidden ${backLink ? "mt-2" : ""}`}>
        <ProjectCoverImage
          name={project.name}
          imageUrl={project.imageUrl}
          className="w-full h-40 object-cover"
          placeholderClassName="w-full h-40"
        />
        <div className="p-5">
          <h1 className="flex items-center gap-2 font-heading text-3xl font-bold text-dark-blue">
            <ProjectIcon iconEmoji={project.iconEmoji} size="lg" />
            <span className="min-w-0 truncate">{project.name}</span>
          </h1>
          {meta.length > 0 && (
            <p className="text-sm text-muted-foreground mt-1">{meta.join(" · ")}</p>
          )}
          {statusBits.length > 0 && (
            <div className="mt-3 max-w-md">
              <p className="text-sm font-medium text-dark-blue">
                {statusBits.join(" · ")}
              </p>
              {progress.overallTotal > 0 && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-accent-teal"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// The project workspace's section tabs. Client-side tab state lives in the
// `?tab=` search param so each section has a shareable, back-navigable URL
// without a loader round-trip (all the data is already client-side).
function TabBar({
  active,
  onSelect,
}: {
  active: PartnerTabId;
  onSelect: (id: PartnerTabId) => void;
}) {
  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Project sections">
        {PARTNER_TABS.map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              aria-current={isActive ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "border-accent-coral text-accent-coral"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// Renders the partner-facing read surface for a project as a tabbed workspace:
// a project header + status line, then Overview / Roadmap / Documents /
// Meetings / Team. Shared by the real partner portal (partner.projects.$id.tsx)
// and the in-app preview any signed-in member can open from the project page
// (projects.$id.partner-view.tsx) — same content, different chrome via
// `backLink`, and `pageHref` for shared-document links. The in-app preview
// instead swaps the project page's "Partner view" header button for an
// "Internal view" one, so it has no back link of its own here.
export function PartnerProjectHubView({
  data,
  currentUserId,
  backLink,
  pageHref,
  calendarFeedUrl,
  canRsvp = false,
}: {
  data: PartnerProjectViewData;
  currentUserId: string;
  backLink?: { to: string; label: string };
  pageHref: (pageId: string) => string;
  // Personal ICS subscribe URL (real portal only; absent in the member preview).
  calendarFeedUrl?: string | null;
  // Whether the RSVP controls are live (real portal only).
  canRsvp?: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab");
  const active: PartnerTabId = PARTNER_TABS.some((t) => t.id === raw)
    ? (raw as PartnerTabId)
    : "overview";
  const selectTab = (id: PartnerTabId) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id === "overview") next.delete("tab");
        else next.set("tab", id);
        return next;
      },
      { preventScrollReset: true },
    );

  return (
    <div className="flex flex-col gap-6">
      <ProjectHeader
        project={data.project}
        partnerSince={data.partnerSince}
        progress={data.progress}
        backLink={backLink}
      />
      <TabBar active={active} onSelect={selectTab} />

      {active === "overview" && (
        <OverviewPanel data={data} onNavigate={selectTab} />
      )}
      {active === "roadmap" && (
        <RoadmapPanel
          epics={data.epics}
          ungroupedSprints={data.ungroupedSprints}
          nextSprint={data.nextSprint}
        />
      )}
      {active === "documents" && (
        <DocumentsPanel
          sharedPages={data.sharedPages}
          sharedFiles={data.sharedFiles}
          pageHref={pageHref}
          currentUserId={currentUserId}
        />
      )}
      {active === "meetings" && (
        <MeetingsPanel
          meetings={data.meetings}
          milestones={data.milestones}
          pageHref={pageHref}
          canRsvp={canRsvp}
          calendarFeedUrl={calendarFeedUrl}
          teamContact={data.teamContact}
          projectName={data.project.name}
        />
      )}
      {active === "team" && (
        <TeamPanel team={data.team} currentTermCode={data.currentTermCode} />
      )}
    </div>
  );
}

// The default landing — answers "how's my project going" at a glance: current
// progress, what's coming up, recent activity, and jumps into the library.
function OverviewPanel({
  data,
  onNavigate,
}: {
  data: PartnerProjectViewData;
  onNavigate: (id: PartnerTabId) => void;
}) {
  const {
    project,
    momentum,
    progress,
    meetings,
    milestones,
    nextSprint,
    activity,
    sharedPages,
    sharedFiles,
  } = data;
  const nextMeeting = meetings[0] ?? null;
  const nextMilestone = milestones[0] ?? null;
  const pct =
    progress.overallTotal > 0
      ? Math.round((progress.overallDone / progress.overallTotal) * 100)
      : 0;
  const newCount = activity.filter((a) => a.isNew).length;

  return (
    <div className="flex flex-col gap-6">
      {project.description && (
        <div className={`${CARD} p-5`}>
          <Markdown>{project.description}</Markdown>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Progress */}
        <div className={`${CARD} p-5`}>
          <h3 className={`${PANEL_HEADING} mb-3`}>Progress</h3>
          {momentum ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-accent-teal">
                Current sprint
              </p>
              <p className="mt-0.5 font-heading text-lg font-bold leading-snug text-dark-blue">
                {momentum.label}
              </p>
              {momentum.total > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {momentum.done} of {momentum.total} tasks
                    </span>
                    <span>
                      {momentum.daysLeft > 0
                        ? `${momentum.daysLeft} day${momentum.daysLeft === 1 ? "" : "s"} left`
                        : "due now"}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-accent-teal"
                      style={{
                        width: `${Math.round((momentum.done / momentum.total) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No sprint is active right now.
              {nextSprint ? ` Next up: ${nextSprint.name}.` : ""}
            </p>
          )}
          {progress.overallTotal > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Overall</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-dark-blue/60"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {progress.overallDone} of {progress.overallTotal} tasks complete
              </p>
            </div>
          )}
        </div>

        {/* What's next */}
        <div className={`${CARD} p-5`}>
          <h3 className={`${PANEL_HEADING} mb-3`}>What's next</h3>
          {nextMeeting || nextMilestone ? (
            <div className="flex flex-col gap-3">
              {nextMeeting && (
                <button
                  type="button"
                  onClick={() => onNavigate("meetings")}
                  className="flex items-start gap-3 rounded-xl border border-border p-3 text-left transition hover:border-accent-coral"
                >
                  <CalendarClock className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-coral" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {nextMeeting.title}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDateTime(nextMeeting.start)}
                    </span>
                  </span>
                </button>
              )}
              {nextMilestone && (
                <div className="flex items-start gap-3 rounded-xl border border-border p-3">
                  <Flag className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-teal" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {nextMilestone.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {fmtDate(nextMilestone.date)}
                    </span>
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onNavigate("meetings")}
                className="self-start text-xs font-medium text-accent-coral hover:underline"
              >
                View calendar →
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing scheduled yet. The team will add meetings and milestones as
              the work gets underway.
            </p>
          )}
        </div>
      </div>

      {/* What's new — the reason to come back: activity since the last visit. */}
      <div className={`${CARD} p-5`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className={PANEL_HEADING}>What's new</h3>
          {newCount > 0 && (
            <span className="flex-shrink-0 rounded-full bg-accent-coral/10 px-2 py-0.5 text-xs font-medium text-accent-coral">
              {newCount} new
            </span>
          )}
        </div>
        <ActivityFeed activity={activity} />
      </div>

      {/* Quick jumps into the library. */}
      {(sharedPages.length > 0 || sharedFiles.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {sharedPages.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("documents")}
              className={`${CARD} flex items-center justify-between p-4 text-left transition hover:border-accent-coral`}
            >
              <span className="text-sm font-medium text-dark-blue">
                {sharedPages.length} shared document
                {sharedPages.length === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-accent-coral">Open →</span>
            </button>
          )}
          {sharedFiles.length > 0 && (
            <button
              type="button"
              onClick={() => onNavigate("documents")}
              className={`${CARD} flex items-center justify-between p-4 text-left transition hover:border-accent-coral`}
            >
              <span className="text-sm font-medium text-dark-blue">
                {sharedFiles.length} shared file
                {sharedFiles.length === 1 ? "" : "s"}
              </span>
              <span className="text-xs text-accent-coral">Open →</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The roadmap — active epics by default, each leading with its schedule
// (sprints across past/current/planned) and its requirements collapsed behind
// a disclosure. Backlog and done epics live behind the "Show all" toggle.
function RoadmapPanel({
  epics,
  ungroupedSprints,
  nextSprint,
}: {
  epics: PartnerProjectEpic[];
  ungroupedSprints: PartnerProjectSprint[];
  nextSprint: PartnerProjectViewData["nextSprint"];
}) {
  const [showAllEpics, setShowAllEpics] = useState(false);
  const activeEpics = epics.filter(
    (e) => e.status === "Open" || e.status === "InProgress",
  );
  const hiddenEpicCount = epics.length - activeEpics.length;
  const visibleEpics = showAllEpics ? epics : activeEpics;
  const hasWork = epics.length > 0 || ungroupedSprints.length > 0;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className={PANEL_HEADING}>Roadmap</h2>
          {nextSprint && (
            <span className="truncate text-xs text-muted-foreground">
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
            {showAllEpics ? "Show active only" : `Show all epics (${epics.length})`}
          </button>
        )}
      </div>
      {!hasWork ? (
        <div className={EMPTY_CARD}>
          Nothing on the roadmap yet. Epics and sprints will appear here once the
          team plans the work.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleEpics.map((epic) => (
            <EpicCard key={epic.id} epic={epic} />
          ))}
          {visibleEpics.length === 0 && (
            <div className={EMPTY_CARD}>
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
            <div className={`${CARD} p-5`}>
              <h3 className="mb-3 font-heading text-base font-semibold text-dark-blue">
                Other sprints
              </h3>
              <SprintGroup sprints={ungroupedSprints} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// The library — documents the team has shared, and file uploads (previewed via
// a short-lived signed URL resolved in the loader).
function DocumentsPanel({
  sharedPages,
  sharedFiles,
  pageHref,
  currentUserId,
}: {
  sharedPages: PartnerProjectViewData["sharedPages"];
  sharedFiles: PartnerProjectViewData["sharedFiles"];
  pageHref: (pageId: string) => string;
  currentUserId: string;
}) {
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className={`${PANEL_HEADING} mb-3`}>Shared documents</h2>
        {sharedPages.length === 0 ? (
          <div className={EMPTY_CARD}>
            The team hasn't shared any documents yet.
          </div>
        ) : (
          <ul className={`${CARD} divide-y divide-border`}>
            {sharedPages.map((p) => (
              <li key={p.id}>
                <Link
                  to={pageHref(p.id)}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-muted/20"
                >
                  <span>{p.iconEmoji ?? "📄"}</span>
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                    {p.title}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    Updated {fmtDate(p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className={`${PANEL_HEADING} mb-3`}>Shared files</h2>
        {sharedFiles.length === 0 ? (
          <div className={EMPTY_CARD}>The team hasn't shared any files yet.</div>
        ) : (
          <ul className={`${CARD} divide-y divide-border`}>
            {sharedFiles.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setPreviewFile(f)}
                  disabled={!f.downloadUrl}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition ${
                    f.downloadUrl
                      ? "cursor-pointer hover:bg-muted/20"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  {isPreviewable(f.contentType) ? (
                    <Eye className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  ) : (
                    <Download className="h-4 w-4 flex-shrink-0 text-accent-teal" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-foreground">
                      {f.title}
                    </span>
                    {(f.fileName || f.sizeBytes != null) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[
                          f.fileName,
                          f.sizeBytes != null ? formatBytes(f.sizeBytes) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
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

      {previewFile && (
        <SharedFilePreviewModal
          file={previewFile}
          currentUserId={currentUserId}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

// Meetings tab: the week calendar (RSVP + notes in-place), a subscribe link for
// the personal ICS feed, and the request-a-meeting form (real portal only).
function MeetingsPanel({
  meetings,
  milestones,
  pageHref,
  canRsvp,
  calendarFeedUrl,
  teamContact,
  projectName,
}: {
  meetings: PartnerProjectViewData["meetings"];
  milestones: PartnerProjectViewData["milestones"];
  pageHref: (pageId: string) => string;
  canRsvp: boolean;
  calendarFeedUrl?: string | null;
  teamContact: PartnerProjectViewData["teamContact"];
  projectName: string;
}) {
  const hasUpcoming = meetings.length > 0 || milestones.length > 0;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className={PANEL_HEADING}>Meetings</h2>
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
      <TeamContactPrompt contact={teamContact} projectName={projectName} />
    </section>
  );
}

// The current-term project roster.
function TeamPanel({
  team,
  currentTermCode,
}: {
  team: PartnerProjectViewData["team"];
  currentTermCode: string | null;
}) {
  return (
    <section>
      <h2 className={`${PANEL_HEADING} mb-3`}>
        Your DALI team
        {currentTermCode ? ` · ${termCodeLabel(currentTermCode)}` : ""}
      </h2>
      {team.length === 0 ? (
        <div className={EMPTY_CARD}>
          Your team will appear here once the project is staffed.
        </div>
      ) : (
        <div className={`${CARD} grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2`}>
          {team.map((m) => (
            <div key={m.name} className="flex min-w-0 items-center gap-3">
              <Avatar photoUrl={m.photoUrl} name={m.name} size="md" />
              <div className="min-w-0">
                <span className="block truncate font-medium text-dark-blue">
                  {m.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {m.domains.join(", ")}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const ACTIVITY_ICON: Record<PartnerActivityKind, typeof CheckCircle2> = {
  "task-done": CheckCircle2,
  "sprint-done": Flag,
  "file-shared": FileText,
  "meeting-scheduled": CalendarClock,
};

// The "what's new" list — newest first, with an "Earlier" divider marking where
// the viewer's previous visit was. New events carry a coral icon; older ones go
// muted. Empty and all-new both read cleanly (no stray divider).
function ActivityFeed({
  activity,
}: {
  activity: PartnerProjectViewData["activity"];
}) {
  if (activity.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No recent activity yet. Updates will show up here as the team makes
        progress.
      </p>
    );
  }
  const firstOlderId = activity.find((a) => !a.isNew)?.id ?? null;
  const hasNew = activity.some((a) => a.isNew);
  return (
    <ul className="flex flex-col">
      {activity.map((a) => {
        const Icon = ACTIVITY_ICON[a.kind];
        return (
          <li key={a.id}>
            {hasNew && a.id === firstOlderId && (
              <div className="my-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                Earlier
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            <div className="flex items-center gap-3 py-2 text-sm">
              <Icon
                className={`h-4 w-4 flex-shrink-0 ${
                  a.isNew ? "text-accent-coral" : "text-muted-foreground"
                }`}
              />
              <span className="min-w-0 flex-1 truncate text-foreground">
                {a.label}
              </span>
              <span className="flex-shrink-0 text-xs text-muted-foreground">
                {fmtDate(a.at)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
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

// "Contact your team" — a direct line to the project's PM instead of a
// fire-and-forget request form. The team schedules and shares meetings, which
// then surface on the calendar above.
function TeamContactPrompt({
  contact,
  projectName,
}: {
  contact: PartnerProjectViewData["teamContact"];
  projectName: string;
}) {
  return (
    <div className={`mt-4 ${CARD} p-4`}>
      <p className="text-sm font-medium text-dark-blue">Need to meet?</p>
      {contact ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {contact.name} is your DALI point of contact — reach out and they'll
          set up a time, which will show up here.{" "}
          <a
            href={`mailto:${contact.email}?subject=${encodeURIComponent(
              `Meeting request — ${projectName}`,
            )}`}
            className="font-medium text-accent-coral hover:underline"
          >
            Email {contact.name.split(" ")[0] || contact.name}
          </a>
        </p>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          Reach out to your DALI team to schedule time — new meetings will show
          up here once they're set.
        </p>
      )}
    </div>
  );
}
