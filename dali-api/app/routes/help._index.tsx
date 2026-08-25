import { Link, redirect } from "react-router";
import {
  BookOpen,
  CalendarDays,
  Compass,
  Cpu,
  Keyboard,
  Bell,
  Users,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import type { Route } from "./+types/help._index";

export const meta: Route.MetaFunction = () => [{ title: "Help · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  return null;
}

const CARDS = [
  {
    to: "/help/getting-started",
    title: "Getting started",
    body: "A short tour of the sidebar and the things you'll touch most often.",
    icon: BookOpen,
  },
  {
    to: "/help/shortcuts",
    title: "Keyboard shortcuts",
    body: "Tabs, panes, in-tab navigation. Stays out of your way until you want it.",
    icon: Keyboard,
  },
  {
    to: "/help/calendar",
    title: "Calendar",
    body: "How linked Google accounts, working hours, and buffers affect scheduling.",
    icon: CalendarDays,
  },
  {
    to: "/help/staffing",
    title: "Staffing",
    body: "Intent to work, project bids, Growth (level-up and domain join), and how PMs see them.",
    icon: Users,
  },
  {
    to: "/help/notifications",
    title: "Notifications",
    body: "What the bell shows, how RSVPs work, where reminders come from.",
    icon: Bell,
  },
  {
    to: "/help/mcp",
    title: "Connect AI assistants",
    body: "Wire Claude Code, Codex, or Claude Desktop into DALI OS via MCP.",
    icon: Cpu,
  },
];

export default function HelpIndex() {
  return (
    <main className="max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Help</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Short articles on how the pieces of DALI OS fit together.
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("dali:start-tour"))}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
        >
          <Compass className="h-4 w-4" />
          Start guide
        </button>
      </div>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map(({ to, title, body, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="block h-full rounded-lg border border-border bg-card p-4 transition hover:bg-muted/50"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground" />
                <div>
                  <h2 className="font-medium text-foreground">{title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
