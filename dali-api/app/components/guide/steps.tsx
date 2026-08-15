import {
  CalendarDays,
  CalendarPlus,
  Camera,
  FileText,
  FolderKanban,
  GraduationCap,
  Globe2,
  ListTodo,
  Bell,
  Search,
  UserCircle2,
  UsersRound,
} from "lucide-react";
import type { GuideStepMeta } from "~/lib/guide";
import { GUIDE_STEPS } from "~/lib/guide";

// Presentation for each step in GUIDE_STEPS, keyed by id. Split from the model
// so the Help page can render the ledger from ~/lib/guide alone (no DOM
// helpers, no lucide) while the guide card gets the click targets and copy.

export type GuideStepView = GuideStepMeta & {
  icon: React.ReactNode;
  /** What to do, shown before the member has done it. */
  cta: React.ReactNode;
  /** What the place is for, shown once they've arrived. */
  arrived?: React.ReactNode;
  /** True when the reported URL means this step is satisfied. */
  matches?: (pathname: string) => boolean;
  /** Locates the element to spotlight. */
  findTarget?: () => HTMLElement | null;
  /** Extra button offered alongside Next. For gated steps this is the thing
   *  that actually satisfies the requirement, so it's shown immediately. */
  action?: { label: string; onClick: () => void };
};

/** Ask the shell to open a workspace tab (or navigate, in tabless mode). */
function openInApp(url: string, label: string) {
  window.postMessage(
    { type: "dali:openTab", url, label },
    window.location.origin,
  );
}

function findInSidebar(
  predicate: (el: HTMLButtonElement) => boolean,
): HTMLElement | null {
  // Look in both the desktop sidebar (<aside>) and the mobile nav panel. We
  // can't use offsetParent to detect hidden containers — the desktop sidebar is
  // position:fixed, which reports offsetParent === null even when visible.
  // getBoundingClientRect's size is the reliable signal: display:none → 0×0,
  // anything actually laid out → non-zero.
  const containers = Array.from(
    document.querySelectorAll<HTMLElement>("aside, #mobile-nav-panel"),
  );
  for (const c of containers) {
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    for (const btn of c.querySelectorAll<HTMLButtonElement>("button")) {
      if (predicate(btn)) return btn;
    }
  }
  return null;
}

/**
 * Sidebar buttons render their label as visible text when expanded and as a
 * `title` attribute when collapsed. Prefix-match rather than exact-match: My
 * Tasks appends a count badge to its text ("My Tasks3") and collapsed titles
 * may carry suffixes ("My Tasks (3)"). Accepts several labels because some
 * entries are renamed by a feature flag (Documents → Drive).
 */
function findByLabel(...labels: string[]) {
  return findInSidebar((btn) => {
    const text = (btn.textContent || "").trim();
    const title = btn.getAttribute("title") || "";
    return labels.some((l) => text.startsWith(l) || title.startsWith(l));
  });
}

const VIEWS: Record<string, Omit<GuideStepView, keyof GuideStepMeta>> = {
  tasks: {
    icon: <ListTodo className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>My Tasks</strong> at the top of the sidebar.
      </>
    ),
    arrived: (
      <>
        Anything waiting on you — assigned tasks, forms to fill out, meeting
        invites to RSVP — lands here. The badge shows how many are open.
      </>
    ),
    matches: (p) => p.startsWith("/notifications"),
    findTarget: () => findByLabel("My Tasks"),
  },

  calendar: {
    icon: <CalendarDays className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>Calendar</strong>.
      </>
    ),
    arrived: (
      <>
        Three tabs live here: <strong>Availability</strong> for the hours you can
        meet, <strong>Schedule</strong> for finding mutual free time, and{" "}
        <strong>Timesheet</strong> for logging the hours you work.
      </>
    ),
    matches: (p) => p.startsWith("/calendar"),
    findTarget: () => findByLabel("Calendar"),
  },

  projects: {
    icon: <FolderKanban className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>Projects</strong>.
      </>
    ),
    arrived: (
      <>
        Every lab project lives here — teams, sprints, and tasks. Once
        you&apos;re staffed, your project&apos;s workspace is where your
        term&apos;s work happens.
      </>
    ),
    matches: (p) => p.startsWith("/projects"),
    findTarget: () => findByLabel("Projects"),
  },

  people: {
    icon: <UsersRound className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>People</strong>.
      </>
    ),
    arrived: (
      <>
        The lab directory — look up anyone, see their roles and domains, and
        find who to ask about what.
      </>
    ),
    // Exact match: /members/<id> pages are profiles, matched by the profile
    // step below.
    matches: (p) => p === "/members",
    findTarget: () => findByLabel("People"),
  },

  education: {
    icon: <GraduationCap className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>Education</strong>.
      </>
    ),
    arrived: (
      <>
        Miniseries and workshops — browse the catalog, sign up, and keep track
        of anything you&apos;re enrolled in.
      </>
    ),
    matches: (p) => p.startsWith("/education"),
    findTarget: () => findByLabel("Education"),
  },

  documents: {
    icon: <FileText className="w-4 h-4" />,
    cta: (
      <>
        Open <strong>Documents</strong> in the sidebar.
      </>
    ),
    arrived: (
      <>
        Lab-wide docs and files, plus anything shared with you. Docs are
        collaborative — several people can type in one at the same time, and
        every change is saved as you go.
      </>
    ),
    matches: (p) => p.startsWith("/documents") || p.startsWith("/drive"),
    findTarget: () => findByLabel("Documents", "Drive"),
  },

  search: {
    icon: <Search className="w-4 h-4" />,
    cta: (
      <>
        Press <strong>⌘K</strong> (<strong>Ctrl&nbsp;K</strong> on Windows) — or
        click <strong>Search</strong> at the top of the sidebar — to jump to any
        person, project, or doc, or run a quick command.
      </>
    ),
  },

  profile: {
    icon: <UserCircle2 className="w-4 h-4" />,
    cta: (
      <>
        Open your <strong>profile</strong> from the bottom of the sidebar.
      </>
    ),
    arrived: (
      <>
        This is the page the rest of the lab sees when they look you up. The
        next few steps fill in the parts that matter.
      </>
    ),
    // The /profile route server-redirects to /members/<id>, and the workspace
    // reports the post-redirect URL — match both.
    matches: (p) => p.startsWith("/profile") || /^\/members\/[^/]+/.test(p),
    findTarget: () =>
      findInSidebar((btn) => btn.getAttribute("aria-label") === "Open profile"),
  },

  "profile-photo": {
    icon: <Camera className="w-4 h-4" />,
    cta: (
      <>
        Add a profile photo. Click the avatar at the top of your profile, then
        upload a picture of your face — it&apos;s how people find you in
        staffing, on project teams, and in the directory.
      </>
    ),
    arrived: (
      <>
        That&apos;s your face on every task, review, and project team you touch.
        You can swap it any time from your profile.
      </>
    ),
    action: { label: "Open my profile", onClick: () => openInApp("/profile", "Profile") },
  },

  timezone: {
    icon: <Globe2 className="w-4 h-4" />,
    cta: (
      <>
        Set your timezone. Every meeting time in DALI OS is shown in it, so an
        off-term or study-abroad member sees their own clock instead of Hanover
        time.
      </>
    ),
    arrived: (
      <>
        Times across DALI OS now render in your zone. Change it from Settings →
        Calendar whenever you move.
      </>
    ),
    action: {
      label: "Open calendar settings",
      onClick: () => openInApp("/settings/calendar", "Calendar settings"),
    },
  },

  "calendar-link": {
    icon: <CalendarPlus className="w-4 h-4" />,
    cta: (
      <>
        Connect your Google Calendar. DALI OS reads only your busy times — never
        event titles — so PMs can schedule around your classes without asking
        you for your schedule.
      </>
    ),
    arrived: (
      <>
        Connected. Your busy times now feed scheduling, and you can add more
        calendars or turn this one off from Settings → Calendar.
      </>
    ),
    action: {
      label: "Connect Google Calendar",
      onClick: () => {
        window.location.href = "/oauth/calendar/google/start";
      },
    },
  },

  notifications: {
    icon: <Bell className="w-4 h-4" />,
    cta: (
      <>
        Last one: choose how the lab reaches you. Every kind of notification can
        go to the app, your email, or a Slack DM — independently.
      </>
    ),
    action: {
      label: "Open notification settings",
      onClick: () =>
        openInApp("/settings/notifications", "Notification settings"),
    },
  },
};

export const GUIDE_STEP_VIEWS: GuideStepView[] = GUIDE_STEPS.map((meta) => {
  const view = VIEWS[meta.id];
  if (!view) throw new Error(`Guide step "${meta.id}" has no view`);
  return { ...meta, ...view };
});
