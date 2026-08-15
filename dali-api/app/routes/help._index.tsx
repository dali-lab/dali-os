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
import {
  GUIDE_CHAPTERS,
  GUIDE_STEPS,
  isStepCleared,
  type GuideRequirements,
  type GuideStepMeta,
} from "~/lib/guide";
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
    <main className="max-w-3xl pb-16">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Help
      </p>

      {/* The page opens with the member's own state, not a headline: the one
          thing they can't look up anywhere else is how far along they are. */}
      <section className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="flex items-baseline gap-1.5 pt-1">
          <span
            className="font-heading font-bold leading-[0.8] tracking-tight text-accent-coral"
            style={{ fontSize: "clamp(3.25rem, 11vw, 5.25rem)" }}
          >
            {progress.cleared}
          </span>
          <span className="font-heading text-2xl font-semibold leading-none text-muted-foreground">
            /{progress.total}
          </span>
        </div>

        <div className="min-w-[16rem] flex-1">
          <h1 className="font-heading text-2xl font-bold leading-tight text-foreground">
            {progress.complete
              ? "You're all set up"
              : started
                ? "Pick up where you left off"
                : "Start with the guide"}
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {progress.complete
              ? "Your account is set up and you've seen every area. Everything below is here whenever you need to look something up."
              : progress.outstanding.length > 0
                ? `The guide walks you through the app and finishes setting up your account. Still waiting on you: ${listOf(
                    progress.outstanding.map((s) => s.title),
                  )}.`
                : "The guide walks you through the app and finishes setting up your account."}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
                  className="rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  Start over
                </button>
              </fetcher.Form>
            )}
          </div>
        </div>
      </section>

      <GuideLedger clearedIds={clearedIds} requirements={requirements} />

      <hr className="mt-12 border-border" />

      <section className="mt-8">
        <h2 className="font-heading text-xl font-bold text-foreground">
          Look it up
        </h2>
        <div className="mt-5 flex flex-col gap-8">
          {SHELVES.map((shelf) => (
            <div key={shelf.title}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {shelf.title}
              </h3>
              <ul className="mt-2 border-t border-border">
                {shelf.articles.map(({ to, title, body, icon: Icon }) => (
                  <li key={to} className="border-b border-border">
                    <Link
                      to={to}
                      className="group flex items-center gap-3 py-3 transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-teal"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-accent-teal" />
                      <span className="font-medium text-foreground">
                        {title}
                      </span>
                      <span className="hidden flex-1 truncate text-sm text-muted-foreground sm:block">
                        {body}
                      </span>
                      <ArrowRight className="h-4 w-4 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

/**
 * The guide as a single continuous spine: one vertical rule down the left whose
 * coral portion ends at the member's current position, with a node per step
 * sitting on it. Required steps get a ring instead of a dot, so the gates read
 * as different from the walk-through steps at a glance.
 */
function GuideLedger({
  clearedIds,
  requirements,
}: {
  clearedIds: string[];
  requirements: GuideRequirements;
}) {
  return (
    <section className="relative mt-10">
      {/* The spine. One rule down the whole guide; each done step colours its
          own segment of it. Contiguous progress reads as a solid coral run,
          and a gap means a step in the middle is still open — which a single
          percentage-filled bar would hide, since the gated steps can be
          satisfied out of order. */}
      <div
        aria-hidden="true"
        className="absolute bottom-2 left-[7px] top-2 w-px bg-border"
      />

      {GUIDE_CHAPTERS.map((chapter) => (
        <div key={chapter.key} className="mt-8 first:mt-0">
          <div className="pl-8">
            <h2 className="font-heading text-lg font-bold text-foreground">
              {chapter.title}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {chapter.blurb}
            </p>
          </div>
          <ol className="mt-2">
            {GUIDE_STEPS.filter((s) => s.chapter === chapter.key).map((step) => (
              <LedgerRow
                key={step.id}
                step={step}
                done={isStepCleared(step, clearedIds, requirements)}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function LedgerRow({ step, done }: { step: GuideStepMeta; done: boolean }) {
  const required = Boolean(step.requires);
  return (
    <li className="relative flex items-baseline gap-3 py-1.5 pl-8">
      {done && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-[7px] top-0 w-px bg-accent-coral"
        />
      )}
      <span
        aria-hidden="true"
        className={
          "absolute left-0 top-2.5 h-[15px] w-[15px] rounded-full border-2 " +
          (done
            ? "border-accent-coral bg-accent-coral"
            : required
              ? "border-accent-coral bg-card"
              : "border-border bg-card")
        }
      />
      <span
        className={
          "text-sm font-medium " +
          (done ? "text-muted-foreground line-through" : "text-foreground")
        }
      >
        {step.title}
      </span>
      <span className="flex-1 text-sm text-muted-foreground">
        {step.summary}
      </span>
      {required && !done && (
        <span className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide text-accent-coral">
          Needs you
        </span>
      )}
      <span className="sr-only">{done ? "Done" : "Not done"}</span>
    </li>
  );
}
