import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import {
  BookOpen,
  CalendarDays,
  Clock3,
  Cpu,
  FileText,
  FolderKanban,
  Keyboard,
  Bell,
  Users,
  ArrowRight,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { loadGuideState, resetGuide } from "~/lib/guide.server";
import { GUIDE_STEPS, isStepCleared, type GuideRequirements } from "~/lib/guide";
import { startGuide } from "~/lib/guide-client";
import type { Route } from "./+types/help._index";

export const meta: Route.MetaFunction = () => [{ title: "Help · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  return { guide: await loadGuideState(auth.user.sub) };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  await resetGuide(auth.user.sub);
  return { ok: true };
}

// Reference articles, grouped by when you reach for them rather than by which
// part of the app they describe — the question a member has is "I'm trying to
// do X", not "which subsystem owns X".
const SHELVES: Array<{
  title: string;
  articles: Array<{
    to: string;
    title: string;
    body: string;
    icon: typeof BookOpen;
  }>;
}> = [
  {
    title: "Day one",
    articles: [
      {
        to: "/help/getting-started",
        title: "Getting started",
        body: "What lives where, area by area.",
        icon: BookOpen,
      },
      {
        to: "/help/shortcuts",
        title: "Keyboard shortcuts",
        body: "Tabs, panes, and in-tab navigation.",
        icon: Keyboard,
      },
    ],
  },
  {
    title: "Your week",
    articles: [
      {
        to: "/help/calendar",
        title: "Calendar and availability",
        body: "Linked accounts, working hours, and buffers.",
        icon: CalendarDays,
      },
      {
        to: "/help/timesheet",
        title: "Logging hours",
        body: "What counts, when it's due, how it's paid.",
        icon: Clock3,
      },
      {
        to: "/help/notifications",
        title: "Notifications",
        body: "What reaches you, where, and how to change it.",
        icon: Bell,
      },
    ],
  },
  {
    title: "Your work",
    articles: [
      {
        to: "/help/projects",
        title: "Projects, sprints, and tasks",
        body: "How a project term is actually run.",
        icon: FolderKanban,
      },
      {
        to: "/help/documents",
        title: "Documents and sharing",
        body: "Collaborative docs, comments, and who can see them.",
        icon: FileText,
      },
      {
        to: "/help/staffing",
        title: "Staffing",
        body: "Intent to work, project bids, and level-up.",
        icon: Users,
      },
    ],
  },
  {
    title: "Going further",
    articles: [
      {
        to: "/help/mcp",
        title: "Connect AI assistants",
        body: "Wire Claude Code, Codex, or Claude Desktop in via MCP.",
        icon: Cpu,
      },
    ],
  },
];

/** "a", "a and b", "a, b, and c" — the outstanding list reads as a sentence. */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export default function HelpIndex() {
  const { guide } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const { progress, clearedIds, requirements } = guide;
  const started = progress.cleared > 0;

  return (
    <main className="pb-16">
      {/* The guide's own state, as a band: the count and the outstanding items
          are the only things on this page a member can't look up. */}
      <section className="overflow-hidden rounded-xl border border-border bg-brand-tint shadow-brand-2">
        <div className="px-6 py-6 sm:px-8 sm:py-7">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-heading text-xs font-bold uppercase tracking-[0.2em] text-dark-blue">
              Your guide
            </p>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {progress.complete
                ? `All ${progress.total} done`
                : `${progress.cleared} of ${progress.total} done`}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
            <div className="max-w-2xl">
              <h1 className="font-heading text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
                {progress.complete
                  ? "You're all set up"
                  : started
                    ? "Pick up where you left off"
                    : "Start with the guide"}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {progress.complete
                  ? "Your account is set up and you've seen every area. Everything below is here whenever you need to look something up."
                  : progress.outstanding.length > 0
                    ? `The guide walks you through the app and finishes setting up your account. Still waiting on you: ${listOf(
                        progress.outstanding.map((s) => s.title),
                      )}.`
                    : "The guide walks you through the app and finishes setting up your account."}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => startGuide()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-coral/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-coral"
              >
                {progress.complete
                  ? "Run the guide again"
                  : started
                    ? "Continue the guide"
                    : "Start the guide"}
                <ArrowRight className="h-4 w-4" />
              </button>
              {started && !progress.complete && (
                <fetcher.Form method="post">
                  <button
                    type="submit"
                    onClick={() => startGuide({ restart: true })}
                    className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-teal"
                  >
                    Start over
                  </button>
                </fetcher.Form>
              )}
            </div>
          </div>
        </div>

        <ProgressStrip clearedIds={clearedIds} requirements={requirements} />
      </section>

      {/* Reference shelves. The group label sits in its own column so the
          articles get the full width of a wide window, and a shelf with one
          article looks deliberate next to a shelf with three. */}
      <section className="mt-12">
        {SHELVES.map((shelf) => (
          <div
            key={shelf.title}
            className="grid gap-x-8 gap-y-4 border-t border-border py-7 md:grid-cols-[9rem_1fr]"
          >
            <h2 className="font-heading text-sm font-bold uppercase tracking-[0.2em] text-dark-blue">
              {shelf.title}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {shelf.articles.map(({ to, title, body, icon: Icon }) => (
                <li key={to}>
                  <Link
                    to={to}
                    className="group flex h-full items-start gap-3 rounded-lg border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-accent-teal hover:shadow-brand-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-teal"
                  >
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-accent-teal/10 text-accent-teal transition-colors group-hover:bg-accent-teal group-hover:text-white">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">
                        {title}
                      </span>
                      <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">
                        {body}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-4 w-4 flex-none text-accent-teal opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </main>
  );
}

/**
 * Progress as the band's bottom edge: one segment per step, filled where that
 * step is cleared. Positional rather than percentage-filled, because the gated
 * steps can be satisfied out of order — a gap means a step in the middle is
 * still open, which a single filled bar would hide.
 */
function ProgressStrip({
  clearedIds,
  requirements,
}: {
  clearedIds: string[];
  requirements: GuideRequirements;
}) {
  const cleared = GUIDE_STEPS.filter((s) =>
    isStepCleared(s, clearedIds, requirements),
  ).length;
  return (
    <div
      role="img"
      aria-label={`${cleared} of ${GUIDE_STEPS.length} guide steps done`}
      className="flex h-1.5 gap-px"
    >
      {GUIDE_STEPS.map((step) => (
        <span
          key={step.id}
          className={
            "flex-1 " +
            (isStepCleared(step, clearedIds, requirements)
              ? "bg-accent-coral"
              : "bg-border")
          }
        />
      ))}
    </div>
  );
}
