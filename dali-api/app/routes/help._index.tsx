import { Link, redirect } from "react-router";
import {
  BookOpen,
  CalendarDays,
  Cpu,
  Keyboard,
  Bell,
  Users,
} from "lucide-react";
import { requireAuth } from "~/lib/auth";
import type { Route } from "./+types/help._index";

export const meta: Route.MetaFunction = () => [{ title: "Help · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
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
    body: "Intent to work, project bids, level-up, and how PMs see them.",
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
      <h1 className="text-2xl font-semibold">Help</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Short articles on how the pieces of DALI OS fit together.
      </p>
      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CARDS.map(({ to, title, body, icon: Icon }) => (
          <li key={to}>
            <Link
              to={to}
              className="block h-full rounded-lg border border-zinc-200 bg-white p-4 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-zinc-500" />
                <div>
                  <h2 className="font-medium text-zinc-900">{title}</h2>
                  <p className="mt-1 text-sm text-zinc-600">{body}</p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
